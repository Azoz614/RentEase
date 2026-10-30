import { before, beforeEach, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, OtpInput, Verification, Register, Recovery, App, Login, Layout, render, screen, waitFor, cleanup, userEvent, axe
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>RentEase authentication tests</title></head><body></body></html>', { url: 'http://localhost/login' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle,
  FormData: dom.window.FormData, sessionStorage: dom.window.sessionStorage, localStorage: dom.window.localStorage,
  requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const times = (extra = {}) => ({ serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), resendAt: new Date(Date.now() + 60000).toISOString(), receivedAt: Date.now(), ...extra })
const setupUser = () => userEvent.setup({ document: dom.window.document })
const codeBoxes = () => screen.getAllByRole('textbox', { name: /digit [1-6]/ })
async function enterDetails(user) {
  await user.type(screen.getByLabelText('Username'), 'New Customer')
  await user.type(screen.getByLabelText('Email'), 'new@example.test')
  await user.type(screen.getByLabelText('Phone number'), '0771234567')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('group', { name: /Verification code/ })
}

before(async () => {
  ;({ render, screen, waitFor, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  axe = (await import('axe-core')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  OtpInput = (await vite.ssrLoadModule('/src/components/ui/OtpInput.jsx')).OtpInput
  Verification = (await vite.ssrLoadModule('/src/features/auth/components/OtpVerification.jsx')).OtpVerification
  Register = (await vite.ssrLoadModule('/src/features/auth/components/Register.jsx')).default
  Recovery = (await vite.ssrLoadModule('/src/features/auth/components/ForgotPassword.jsx')).default
  Login = (await vite.ssrLoadModule('/src/features/auth/components/LoginForm.jsx')).default
  Layout = (await vite.ssrLoadModule('/src/layouts/AuthLayout.jsx')).default
  App = (await vite.ssrLoadModule('/src/app/App.jsx')).default
})
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear(); window.history.replaceState({}, '', '/login')
  globalThis.fetch = async () => reply({ message: 'Unexpected request' }, 500)
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('OTP boxes advance, filter non-digits, paste full codes and support keyboard corrections', async () => {
  const user = setupUser()
  render(React.createElement(OtpInput, { name: 'otp', autoFocus: true }))
  const boxes = codeBoxes()
  assert.equal(document.activeElement, boxes[0])
  await user.keyboard('1')
  assert.equal(document.activeElement, boxes[1])
  await user.keyboard('x2')
  assert.equal(boxes[1].value, '2')
  assert.equal(document.activeElement, boxes[2])
  await user.keyboard('{Backspace}')
  assert.equal(document.activeElement, boxes[1]); assert.equal(boxes[1].value, '2')
  await user.paste('123456')
  assert.deepEqual(boxes.map((box) => box.value), ['1', '2', '3', '4', '5', '6'])
  await user.keyboard('{ArrowLeft}')
  assert.equal(document.activeElement, boxes[4])
  await user.keyboard('{Home}')
  assert.equal(document.activeElement, boxes[0])
  await user.keyboard('{Delete}7')
  assert.deepEqual(boxes.map((box) => box.value), ['7', '2', '3', '4', '5', '6'])
  assert.equal(document.querySelector('input[name="otp"]').value, '723456')
  assert.ok(boxes.every((box) => box.inputMode === 'numeric'))
})

test('OTP errors color all boxes, clear on edits and show green success before advancing', async () => {
  const user = setupUser(); let attempts = 0, advanced = false
  render(React.createElement(Verification, { email: 'person@example.test', challenge: times(),
    onVerify: async () => { attempts += 1; if (attempts === 1) throw new Error('That code is incorrect.'); return { proof: true } },
    onVerified: () => { advanced = true }, onResend: async () => {}, onBack: () => {} }))
  await user.paste('111111')
  await user.click(screen.getByRole('button', { name: 'Verify email' }))
  assert.ok(await screen.findByRole('alert'))
  assert.ok(screen.getByRole('group').classList.contains('is-error'))
  assert.ok(codeBoxes().every((box) => box.getAttribute('aria-invalid') === 'true'))
  await user.click(codeBoxes()[0]); await user.keyboard('2')
  assert.ok(screen.getByRole('group').classList.contains('is-idle'))
  await user.click(screen.getByRole('button', { name: 'Verify email' }))
  assert.ok(await screen.findByText('Email verified successfully'))
  assert.ok(screen.getByRole('group').classList.contains('is-success'))
  assert.equal(advanced, false)
  assert.ok(codeBoxes().every((box) => box.disabled))
  await waitFor(() => assert.equal(advanced, true), { timeout: 2000 })
})

test('OTP verification prevents duplicate submissions and enforces expiry and resend timing', async () => {
  const user = setupUser(); let calls = 0, release
  const pending = new Promise((resolve) => { release = resolve })
  const first = render(React.createElement(Verification, { email: 'person@example.test', challenge: times(),
    onVerify: async () => { calls += 1; return pending }, onVerified: () => {}, onResend: async () => {}, onBack: () => {} }))
  assert.equal(screen.getByRole('button', { name: /Resend in/ }).disabled, true)
  await user.paste('123456'); await user.dblClick(screen.getByRole('button', { name: 'Verify email' }))
  assert.equal(calls, 1); release({}); first.unmount()
  render(React.createElement(Verification, { email: 'person@example.test', challenge: times({ expiresAt: new Date(Date.now() - 1000).toISOString(), resendAt: new Date(0).toISOString() }),
    onVerify: async () => {}, onVerified: () => {}, onResend: async () => {}, onBack: () => {} }))
  assert.equal(screen.getByRole('button', { name: 'Verify email' }).disabled, true)
  assert.ok(screen.getByText(/Your code has expired/))
  assert.equal(screen.getByRole('button', { name: 'Resend code' }).disabled, false)
})

test('registration confirms passwords, passes verification proof and finishes without signing in', async () => {
  const user = setupUser(); const calls = []; let completed
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body })
    if (url.endsWith('send-otp')) return reply(times())
    if (url.endsWith('verify-otp')) return reply({ registrationToken: 'registration-proof', expiresAt: new Date(Date.now() + 600000).toISOString() })
    return reply({ message: 'Account created successfully. Please sign in.' }, 201)
  }
  render(React.createElement(Register, { onComplete: (result) => { completed = result }, onLogin: () => {} }))
  await enterDetails(user); await user.paste('123456')
  await user.click(screen.getByRole('button', { name: 'Verify email' }))
  await screen.findByLabelText('Password', {}, { timeout: 2000 })
  await user.type(screen.getByLabelText('Password'), 'A-good-passphrase')
  await user.type(screen.getByLabelText('Confirm password'), 'A-wrong-passphrase')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  assert.match(screen.getByRole('alert').textContent, /do not match/)
  assert.equal(calls.filter((call) => call.url.endsWith('/complete')).length, 0)
  await user.clear(screen.getByLabelText('Confirm password')); await user.type(screen.getByLabelText('Confirm password'), 'A-good-passphrase')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  await waitFor(() => assert.equal(completed?.email, 'new@example.test'))
  assert.equal(calls.at(-1).body.registrationToken, 'registration-proof')
  assert.equal(localStorage.length, 0); assert.equal(sessionStorage.getItem('rentease.registration'), null)
})

test('registration resumes after refresh without storing the password or OTP', async () => {
  const user = setupUser()
  globalThis.fetch = async () => reply(times())
  const first = render(React.createElement(Register, { onComplete: () => {}, onLogin: () => {} }))
  await enterDetails(user); await user.paste('123456')
  const stored = JSON.parse(sessionStorage.getItem('rentease.registration'))
  assert.equal(stored.otp, undefined); assert.equal(stored.password, undefined)
  assert.equal(stored.challenge.otp, undefined); assert.equal(stored.details.password, undefined)
  first.unmount()
  render(React.createElement(Register, { onComplete: () => {}, onLogin: () => {} }))
  assert.ok(screen.getByRole('heading', { name: 'Check your email' }))
  assert.equal(codeBoxes()[0].value, '')
})

test('forgot password uses its own proof, clears it after reset and returns sign-in feedback', async () => {
  const user = setupUser(); let completed; const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    if (url.endsWith('/verify-otp')) return reply({ resetToken: 'reset-proof' })
    if (url.endsWith('/reset-password')) return reply({ message: 'Password reset successfully. Please sign in.' })
    return reply(times())
  }
  render(React.createElement(Recovery, { onLogin: () => {}, onComplete: (result) => { completed = result } }))
  await user.type(screen.getByLabelText('Email'), 'person@example.test')
  await user.click(screen.getByRole('button', { name: 'Send reset code' }))
  await screen.findByRole('group'); await user.paste('123456')
  await user.click(screen.getByRole('button', { name: 'Verify email' }))
  await screen.findByLabelText('New password', {}, { timeout: 2000 })
  await user.type(screen.getByLabelText('New password'), 'A-good-passphrase')
  await user.type(screen.getByLabelText('Confirm password'), 'A-good-passphrase')
  await user.click(screen.getByRole('button', { name: 'Reset password' }))
  await waitFor(() => assert.match(completed.message, /Password reset successfully/))
  assert.equal(calls.at(-1).url, '/api/auth/reset-password')
  assert.equal(calls.at(-1).body.resetToken, 'reset-proof')
  assert.equal(sessionStorage.length, 0)
})

test('authentication routes open directly and browser navigation restores the correct screen', async () => {
  const user = setupUser()
  render(React.createElement(App))
  assert.ok(screen.getByRole('button', { name: 'Sign in' }))
  await user.click(screen.getByRole('link', { name: 'Forgot password?' }))
  assert.equal(window.location.pathname, '/forgot-password')
  assert.ok(screen.getByRole('button', { name: 'Send reset code' }))
  await user.click(screen.getByRole('link', { name: /Back to sign in/ }))
  assert.equal(window.location.pathname, '/login')
  window.history.back()
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'Send reset code' })))
})

test('registration completion redirects to login with persistent success feedback and prefilled email', async () => {
  const user = setupUser()
  window.history.replaceState({}, '', '/register')
  sessionStorage.setItem('rentease.registration', JSON.stringify({ details: { name: 'New Customer', email: 'new@example.test', phone: '0771234567', accountType: 'user' }, challenge: times(), registrationToken: 'proof', expiresAt: new Date(Date.now() + 600000).toISOString() }))
  globalThis.fetch = async () => reply({ message: 'Account created successfully. Please sign in.' }, 201)
  const first = render(React.createElement(App))
  await user.type(screen.getByLabelText('Password'), 'A-good-passphrase')
  await user.type(screen.getByLabelText('Confirm password'), 'A-good-passphrase')
  await user.click(screen.getByRole('button', { name: 'Create account' }))
  await screen.findByRole('button', { name: 'Sign in' })
  assert.equal(window.location.pathname, '/login')
  assert.match(screen.getByRole('status').textContent, /Account created successfully/)
  assert.equal(screen.getByLabelText('Email').value, 'new@example.test')
  assert.equal(localStorage.length, 0)
  first.unmount(); render(React.createElement(App))
  assert.ok(screen.getByRole('button', { name: 'Sign in' }))
  assert.equal(screen.queryByRole('button', { name: 'Create account' }), null)
})

test('login and OTP controls have accessible labels, status messages and no serious axe violations', async () => {
  const first = render(React.createElement(Layout, { onBrowse: () => {}, showLogin: () => {}, showRegister: () => {} },
    React.createElement(Login, { onRegister: () => {}, onLoginSuccess: () => {}, onForgotPassword: () => {} })))
  let report = await axe.run(first.container, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(report.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id), [])
  first.unmount()
  const second = render(React.createElement('main', null, React.createElement(Verification, { email: 'person@example.test', challenge: times(), onVerify: async () => {}, onVerified: () => {}, onResend: async () => {}, onBack: () => {} })))
  report = await axe.run(second.container, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(report.violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id), [])
})
