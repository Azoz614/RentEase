import { before, beforeEach, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Marketplace improvements</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement,
  MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, FormData: dom.window.FormData,
  requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
let vite, Notifications, Google, Commission, Rentals, Customer, render, screen, within, waitFor, act, cleanup, userEvent, axe
let callback, clicked, credentialAttempt
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const user = () => userEvent.setup({ document: dom.window.document })
before(async () => {
  ;({ render, screen, within, waitFor, act, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default; axe = (await import('axe-core')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  Notifications = (await vite.ssrLoadModule('/src/features/notifications/pages/NotificationCenter.jsx')).default
  Google = (await vite.ssrLoadModule('/src/features/auth/components/GoogleSignIn.jsx')).default
  Commission = (await vite.ssrLoadModule('/src/features/payments/components/CommissionPanel.jsx')).default
  Rentals = (await vite.ssrLoadModule('/src/features/rentals/pages/CustomerRentals.jsx')).default
  Customer = (await vite.ssrLoadModule('/src/features/customer/pages/CustomerPage.jsx')).default
})
beforeEach(() => {
  callback = null; clicked = null; credentialAttempt = null
  window.google = { accounts: { id: {
    initialize: (options) => { callback = options.callback },
    renderButton: (host, options) => { host.textContent = 'Google account chooser'; clicked = options.click_listener }, cancel: () => {},
  } } }
  globalThis.fetch = async () => response({ enabled: true, clientId: 'test-web-client', nonce: 'test-nonce' })
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('Google securely requests an existing password before linking and returns the correct role session', async () => {
  const tester = user(); let result
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/config')) return response({ enabled: true, clientId: 'test-web-client', nonce: 'test-nonce' })
    credentialAttempt = JSON.parse(options.body)
    if (!credentialAttempt.password) return response({ code: 'GOOGLE_LINK_REQUIRED', message: 'Confirm your existing RentEase password.' }, 409)
    return response({ token: 'test-session', user: { role: 'rental_shop' } })
  }
  render(React.createElement(Google, { onLoginSuccess: (account, token) => { result = { account, token } } }))
  await waitFor(() => assert.equal(typeof callback, 'function'))
  await act(async () => { callback({ credential: 'test-signed-credential' }) })
  const password = await screen.findByLabelText('Existing RentEase password')
  await tester.type(password, 'Existing-secure-passphrase')
  await tester.click(screen.getByRole('button', { name: 'Link Google securely' }))
  await waitFor(() => assert.equal(result?.account.role, 'rental_shop'))
  assert.equal(credentialAttempt.credential, 'test-signed-credential')
  assert.equal(credentialAttempt.password, 'Existing-secure-passphrase')
  assert.equal(password.value, '')
})

test('Google profile completion collects a phone and cancellation never authenticates a user', async () => {
  const tester = user(); let loggedIn = false
  globalThis.fetch = async (url, options) => url.endsWith('/config') ? response({ enabled: true, clientId: 'test-web-client', nonce: 'test-nonce' })
    : (credentialAttempt = JSON.parse(options.body), response({ code: 'GOOGLE_PROFILE_REQUIRED', message: 'Add a contact number.' }, 409))
  const first = render(React.createElement(Google, { onLoginSuccess: () => { loggedIn = true } }))
  await waitFor(() => assert.equal(typeof clicked, 'function'))
  await act(async () => { clicked() })
  await tester.click(screen.getByRole('button', { name: 'Cancel Google sign-in' }))
  assert.ok(await screen.findByText(/Google sign-in cancelled/)); assert.equal(loggedIn, false)
  first.unmount()
  render(React.createElement(Google, { onLoginSuccess: () => { loggedIn = true } }))
  await waitFor(() => assert.equal(typeof callback, 'function'))
  await act(async () => { callback({ credential: 'test-credential' }) })
  assert.ok(await screen.findByLabelText('Contact phone number'))
  assert.ok(screen.getByLabelText('Create a RentEase password'))
  assert.equal(loggedIn, false)
})

test('notification open marks read immediately, persists history, supports Read filtering and rolls back errors', async () => {
  const tester = user(); let destination, fail = false
  let rows = [{ _id: 'notification-1', title: 'Rental confirmed', body: 'Your booking is ready.', readAt: null, createdAt: new Date().toISOString(), type: 'rental', link: 'requests', requestId: 'booking-1' }]
  const api = async (_url, options = {}) => {
    if (options.method) {
      if (fail) throw new Error('Network unavailable')
      rows = rows.map((row) => ({ ...row, readAt: JSON.parse(options.body).read ? new Date().toISOString() : null }))
      return { notification: rows[0] }
    }
    return { notifications: rows }
  }
  render(React.createElement(Notifications, { api, onNavigate: (target, row) => { destination = { target, row } } }))
  await tester.click(await screen.findByRole('button', { name: 'Rental confirmed' }))
  const details = await screen.findByRole('dialog', { name: 'Rental confirmed' })
  assert.ok(within(details).getByText('Your booking is ready.')); assert.ok(within(details).getByText('Booking update'))
  assert.equal(screen.queryByText('NEW'), null)
  await tester.click(within(details).getByRole('button', { name: /Go to booking/ }))
  assert.equal(screen.queryByRole('dialog'), null); assert.ok(screen.getByRole('button', { name: 'Mark unread' }))
  assert.equal(destination.row.requestId, 'booking-1')
  await tester.click(screen.getByRole('button', { name: 'Read', exact: true }))
  assert.ok(screen.getByRole('heading', { name: 'Rental confirmed' }))
  fail = true
  await tester.click(screen.getByRole('button', { name: 'Mark unread' }))
  assert.ok(await screen.findByRole('alert')); assert.ok(screen.getByRole('button', { name: 'Mark unread' }))
})

test('new Google accounts set a confirmed password usable by existing NIC security checks', async () => {
  const tester = user(); let completed = false, attempts = 0
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/config')) return response({ enabled: true, clientId: 'test-web-client', nonce: 'test-nonce' })
    credentialAttempt = JSON.parse(options.body); attempts += 1
    if (!credentialAttempt.phone) return response({ code: 'GOOGLE_PROFILE_REQUIRED', message: 'Finish your account details.' }, 409)
    return response({ token: 'new-session', user: { role: 'user' } })
  }
  render(React.createElement(Google, { onLoginSuccess: () => { completed = true } }))
  await waitFor(() => assert.equal(typeof callback, 'function'))
  await act(async () => { callback({ credential: 'test-new-google-credential' }) })
  await tester.type(await screen.findByLabelText('Contact phone number'), '0771234567')
  await tester.type(screen.getByLabelText('Create a RentEase password'), 'New-secure-passphrase')
  await tester.type(screen.getByLabelText('Confirm password'), 'Different-passphrase')
  await tester.click(screen.getByRole('button', { name: 'Finish Google sign-in' }))
  assert.equal(attempts, 1); assert.equal(completed, false)
  await tester.clear(screen.getByLabelText('Confirm password')); await tester.type(screen.getByLabelText('Confirm password'), 'New-secure-passphrase')
  await tester.click(screen.getByRole('button', { name: 'Finish Google sign-in' }))
  await waitFor(() => assert.equal(completed, true))
  assert.equal(credentialAttempt.phone, '0771234567')
  assert.equal(credentialAttempt.password, 'New-secure-passphrase')
  assert.equal(credentialAttempt.confirmPassword, 'New-secure-passphrase')
})

test('unverified customers still receive the catalog when identity, wishlist or inbox requests fail', async () => {
  const tester = user(), calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).startsWith('/api/products')) return response({ products: [{ _id: 'camera', title: 'Available camera', category: 'Cameras', dailyRate: 2500, available: true, photos: [] }], mapsConfigured: false })
    if (String(url).startsWith('/api/identity') || String(url).startsWith('/api/inbox') || url === '/api/wishlist') return response({ message: 'Service temporarily unavailable' }, 503)
    return response({ requests: [] })
  }
  render(React.createElement(Customer, { user: { username: 'Customer', email: 'customer@example.test', role: 'user' }, token: 'test-session' }))
  await tester.click(await screen.findByRole('button', { name: /Add to request/ }))
  assert.ok(screen.getByRole('heading', { name: 'Available camera' }))
  assert.ok(screen.getByRole('button', { name: 'Verify NIC' }))
  assert.ok(screen.getByText(/Verify your NIC and residential address before requesting/))
  assert.equal(calls.filter((call) => call.url === '/api/requests' && call.options.method === 'POST').length, 0)
})

test('finance cards and transaction history use API amounts and expose real status/date filters', async () => {
  const tester = user(), urls = []
  const api = async (url) => { urls.push(url); return { rental: { grossMinor: 1000000, commissionMinor: 50000, earnedMinor: 50000, netMinor: 950000, pendingMinor: 50000 }, delivery: { grossMinor: 50000, commissionMinor: 500, earnedMinor: 500, netMinor: 49500, pendingMinor: 500 }, ledgerOnly: true,
    settlementNote: 'No payout gateway is connected.', entries: [{ _id: 'rental:1', rentalId: 'booking-123', kind: 'rental', status: 'earned', paymentProvider: 'sandbox', createdAt: new Date().toISOString(), grossMinor: 1000000, commissionMinor: 50000, netMinor: 950000 }], pages: 1 } }
  render(React.createElement(Commission, { api }))
  assert.ok(await screen.findByText('Total commission earned'))
  assert.ok(screen.getAllByText(/505\.00/).length)
  assert.ok(screen.getByText(/No payout gateway is connected/))
  assert.ok(screen.getByText('Sandbox · no real funds charged'))
  await tester.selectOptions(screen.getByLabelText('Revenue type'), 'delivery')
  await waitFor(() => assert.ok(urls.at(-1).includes('kind=delivery')))
  await tester.selectOptions(screen.getByLabelText('Allocation status'), 'earned')
  await waitFor(() => assert.ok(urls.at(-1).includes('status=earned')))
})

test('My Rentals separates completed and cancelled records and retains contextual detail actions', async () => {
  const tester = user()
  const rentals = ['active', 'completed', 'cancelled'].map((status, i) => ({ _id: `booking-${i}`, status, items: [{ productId: `product-${i}`, title: `${status} camera`, rentalAmount: 2500, decision: 'accepted' }], subtotal: 2500, total: 2500, createdAt: new Date().toISOString(), startDate: new Date().toISOString(), endDate: new Date(Date.now() + 86400000).toISOString(), deliveryMethod: 'pickup', payment: { status: 'authorized' }, cancellation: { allowed: false } }))
  render(React.createElement(Rentals, { initialRentals: rentals, api: async () => ({ requests: rentals }), user: { email: 'customer@example.test' }, onBrowse: () => {}, onMessages: () => {} }))
  await screen.findByRole('heading', { name: 'active camera' })
  assert.ok(screen.getByRole('heading', { name: /In progress/ }))
  await tester.click(screen.getByRole('button', { name: /^Cancelled/ }))
  assert.ok(screen.getByRole('heading', { name: 'cancelled camera' })); assert.equal(screen.queryByRole('heading', { name: 'active camera' }), null)
  await tester.click(screen.getByRole('button', { name: /^Completed/ }))
  assert.ok(screen.getByRole('heading', { name: 'completed camera' })); assert.equal(screen.queryByRole('button', { name: 'Cancel booking' }), null)
})

test('notification controls have no serious structural accessibility violations', async () => {
  const view = render(React.createElement('main', null, React.createElement(Notifications, { api: async () => ({ notifications: [] }), onNavigate: () => {} })))
  await screen.findByText('No updates in this view')
  const report = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(report.violations.filter((entry) => ['critical', 'serious'].includes(entry.impact)).map((entry) => entry.id), [])
})
