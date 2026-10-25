import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, Verification, Addresses, Notifications, Admin, render, screen, within, cleanup, userEvent, axe
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Identity UI tests</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FileReader: dom.window.FileReader, requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
const address = { _id: 'address-1', line1: '12 Example Lane', line2: '', city: 'Colombo', district: 'Colombo', province: 'Western', postalCode: '00100', country: 'Sri Lanka', isDefault: true }
const profile = (extra = {}) => ({ status: 'not_submitted', fullName: 'Example Customer', phone: '0771234567', email: 'customer@example.test', eligible: false, maskedNic: '', history: [], defaultAddress: address, ...extra })
before(async () => {
  ;({ render, screen, within, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  axe = (await import('axe-core')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  Verification = (await vite.ssrLoadModule('/src/features/identity/pages/CustomerVerification.jsx')).default
  Addresses = (await vite.ssrLoadModule('/src/features/identity/pages/AddressManager.jsx')).default
  Notifications = (await vite.ssrLoadModule('/src/features/notifications/pages/NotificationCenter.jsx')).default
  Admin = (await vite.ssrLoadModule('/src/features/identity/pages/CustomerVerifications.jsx')).default
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('four-step verification includes photos, address, consent and password confirmation before real submission', async () => {
  let current = profile(), submitted
  const api = async (url) => url.endsWith('check-nic') ? { available: true } : current
  const upload = async (body, token, progress) => { submitted = { body, token }; progress(100); current = profile({ status: 'pending', maskedNic: '20••••001', submittedAt: new Date().toISOString() }); return { message: 'Your NIC verification is under review.' } }
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(Verification, { api, token: 'test-session', upload, onBack: () => {} }))
  await screen.findByLabelText('NIC number')
  await user.type(screen.getByLabelText('NIC number'), '200000100001')
  await user.type(screen.getByLabelText('Date of birth'), '2000-01-01')
  await user.click(screen.getByRole('button', { name: 'Continue →' }))
  const file = new dom.window.File(['test-only-photo'], 'identity.png', { type: 'image/png' })
  await user.upload(screen.getByLabelText('Choose NIC front photo'), file)
  await user.upload(screen.getByLabelText('Choose NIC back photo'), file)
  assert.ok(await screen.findByAltText('Your NIC front preview'))
  assert.ok(await screen.findByAltText('Your NIC back preview'))
  await user.click(screen.getByRole('button', { name: 'Continue →' }))
  assert.equal(screen.getByLabelText('City').value, 'Colombo')
  await user.click(screen.getByRole('button', { name: 'Continue →' }))
  await user.click(screen.getByRole('checkbox', { name: /I confirm this information/ }))
  await user.click(screen.getByRole('button', { name: 'Submit for review' }))
  assert.equal(submitted, undefined)
  const dialog = screen.getByRole('dialog', { name: 'Submit verification securely' })
  await user.type(within(dialog).getByLabelText('Current password'), 'test-secret-only')
  await user.click(within(dialog).getByRole('button', { name: 'Confirm securely' }))
  assert.ok(await screen.findByRole('heading', { name: 'Your submission is safely with the team' }))
  assert.equal(submitted.body.consent, true)
  assert.equal(submitted.body.password, 'test-secret-only')
  assert.equal(submitted.token, 'test-session')
  assert.ok(!screen.queryByLabelText('Current password'))
})

test('duplicate NIC feedback preserves privacy and offers a support claim instead of advancing', async () => {
  const api = async (url) => { if (url.endsWith('check-nic')) throw Object.assign(new Error('This NIC number is already registered. Please check the number or contact support.'), { code: 'DUPLICATE_NIC' }); return profile() }
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(Verification, { api, onBack: () => {} }))
  await screen.findByLabelText('NIC number')
  await user.type(screen.getByLabelText('NIC number'), '200000100001'); await user.type(screen.getByLabelText('Date of birth'), '2000-01-01')
  await user.click(screen.getByRole('button', { name: 'Continue →' }))
  assert.ok(await screen.findByRole('alert'))
  assert.ok(screen.getByRole('heading', { name: 'Need help with this NIC?' }))
  assert.ok(!screen.queryByLabelText('Choose NIC front photo'))
})

test('pending and rejected identities show review progress or correction feedback accurately', async () => {
  const pendingApi = async () => profile({ status: 'pending', maskedNic: '20••••001', submittedAt: new Date().toISOString() })
  const first = render(React.createElement(Verification, { api: pendingApi, onBack: () => {} }))
  assert.ok(await screen.findByRole('heading', { name: 'Your submission is safely with the team' }))
  assert.ok(!screen.queryByLabelText('NIC number'))
  first.unmount()
  const rejectedApi = async () => profile({ status: 'rejected', reviewNote: 'Upload a sharper front photo.', nic: '200000100001', dateOfBirth: '2000-01-01' })
  render(React.createElement(Verification, { api: rejectedApi, onBack: () => {} }))
  assert.ok(await screen.findByText('Upload a sharper front photo.'))
  assert.equal(screen.getByLabelText('NIC number').value, '200000100001')
})

test('address editing requires a password modal and does not post before confirmation', async () => {
  const calls = []
  const api = async (url, options = {}) => { calls.push({ url, options }); return options.method ? { message: 'Address updated securely.' } : { addresses: [address], previousRentalAddresses: [] } }
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(Addresses, { api, onBack: () => {} }))
  await user.click(await screen.findByRole('button', { name: 'Edit address' }))
  await user.clear(screen.getByLabelText('Address line 1')); await user.type(screen.getByLabelText('Address line 1'), '99 New Road')
  await user.click(screen.getByRole('button', { name: 'Save with password confirmation' }))
  assert.equal(calls.filter((call) => call.options.method).length, 0)
  const dialog = screen.getByRole('dialog')
  await user.type(within(dialog).getByLabelText('Current password'), 'test-secret-only')
  await user.click(within(dialog).getByRole('button', { name: 'Confirm securely' }))
  assert.ok(await screen.findByRole('status'))
  const submission = calls.find((call) => call.options.method === 'PUT')
  assert.equal(JSON.parse(submission.options.body).address.line1, '99 New Road')
  assert.equal(JSON.parse(submission.options.body).password, 'test-secret-only')
})

test('wrong address-change password clears the password field and displays backend feedback', async () => {
  const api = async (_url, options = {}) => { if (options.method) throw new Error('Incorrect password. Please try again.'); return { addresses: [address], previousRentalAddresses: [] } }
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(Addresses, { api, onBack: () => {} }))
  await user.click(await screen.findByRole('button', { name: 'Edit address' }))
  await user.click(screen.getByRole('button', { name: 'Save with password confirmation' }))
  await user.type(screen.getByLabelText('Current password'), 'wrong-secret')
  await user.click(screen.getByRole('button', { name: 'Confirm securely' }))
  assert.ok(await screen.findByRole('alert'))
  assert.equal(screen.getByLabelText('Current password').value, '')
})

test('notifications support read/unread changes and navigate to the relevant verification page', async () => {
  let notification = { _id: 'notice-1', title: 'Identity Verification Approved', body: 'Your NIC verification has been approved successfully.', readAt: null, createdAt: new Date().toISOString(), link: 'verification' }, destination
  const api = async (_url, options = {}) => { if (options.method) notification = { ...notification, readAt: JSON.parse(options.body).read ? new Date().toISOString() : null }; return { notifications: [notification] } }
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(Notifications, { api, onNavigate: (value) => { destination = value } }))
  await user.click(await screen.findByRole('button', { name: 'Mark read' }))
  assert.ok(await screen.findByRole('button', { name: 'Mark unread' }))
  await user.click(screen.getByRole('button', { name: 'View update' }))
  assert.equal(destination, 'verification')
})

test('admin queue masks NIC until a deliberate details view and requires evidence review before a decision', async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    const verification = { _id: 'verification-1', userId: 'customer-1', fullName: 'Example Customer', nicMasked: '20••••001', nic: '200000100001', dateOfBirth: '2000-01-01', status: 'pending', revision: 1, address, history: [], hasFront: false, hasBack: false }
    const result = String(url).includes('/disputes') ? { disputes: [] } : String(url).endsWith('/decision') ? { message: 'Identity Verification Approved' } : String(url).endsWith('/verification-1') ? { verification } : { verifications: [{ _id: verification._id, userId: verification.userId, fullName: verification.fullName, nicMasked: verification.nicMasked, status: 'pending' }], total: 1, pages: 1 }
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json' } })
  }
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(Admin, { token: 'test-admin-session' }))
  await screen.findByText('20••••001')
  assert.ok(!screen.queryByText('200000100001'))
  await user.click(screen.getByRole('button', { name: 'View Details' }))
  assert.ok(await screen.findByText('200000100001'))
  const dialog = screen.getByRole('dialog')
  assert.ok(within(dialog).getByRole('button', { name: 'Record verification decision' }).disabled)
  await user.click(within(dialog).getByRole('checkbox', { name: /I reviewed the submitted identity/ }))
  await user.click(within(dialog).getByRole('button', { name: 'Record verification decision' }))
  assert.ok(await screen.findByRole('status'))
  assert.equal(JSON.parse(calls.find((call) => call.url.endsWith('/decision')).options.body).revision, 1)
})

test('verification form passes structural accessibility checks', async () => {
  const api = async () => profile()
  const { container } = render(React.createElement(Verification, { api, onBack: () => {} }))
  await screen.findByLabelText('NIC number')
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(result.violations.map((violation) => violation.id), [])
})
