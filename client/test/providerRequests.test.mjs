import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, AdminPage, OwnerHome, useProviderRequests, render, screen, within, waitFor, act, cleanup, userEvent
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Provider request tests</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
const booking = (extra = {}) => ({ _id: 'request-1', customerId: { username: 'Example Customer', email: 'customer@example.test', identityStatus: 'approved' }, items: [{ productId: 'item-1', providerId: 'shop-1', title: 'New camera request', decision: 'pending', rentalAmount: 2500 }], status: 'pending', deliveryMethod: 'pickup', total: 2500, startDate: '2026-12-01', endDate: '2026-12-02', createdAt: '2026-10-22T10:00:00Z', ...extra })
const response = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body), json: async () => body })
function adminApi({ snapshot, failOverview = false, onDecision = () => {} }) {
  globalThis.fetch = async (url, options = {}) => {
    if (url === '/api/provider/requests') return response({ requests: snapshot() })
    if (url.startsWith('/api/provider/requests/') && options.method === 'PATCH') { onDecision(url, JSON.parse(options.body)); return response({ message: 'Request accepted.' }) }
    if (url === '/api/admin/overview') return response(failOverview ? { message: 'Overview temporarily unavailable.' } : { users: 0, activeUsers: 0, products: 0, pendingShops: 0, roles: [], categories: [], activity: [] }, failOverview ? 503 : 200)
    if (url === '/api/admin/users') return response({ users: [] })
    if (url === '/api/admin/products') return response({ products: [] })
    if (url === '/api/admin/shops/pending') return response({ shops: [] })
    if (url === '/api/admin/audit') return response({ events: [] })
    if (url === '/api/admin/coupons') return response({ coupons: [] })
    if (url === '/api/admin/packages') return response({ packages: [] })
    if (url === '/api/admin/reports/revenue') return response({ byDay: [] })
    throw new Error('Unexpected test endpoint: ' + url)
  }
}
before(async () => {
  ;({ render, screen, within, waitFor, act, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  AdminPage = (await vite.ssrLoadModule('/src/features/admin/pages/AdminPage.jsx')).default
  OwnerHome = (await vite.ssrLoadModule('/src/features/shop-owner/pages/OwnerHome.jsx')).default
  useProviderRequests = (await vite.ssrLoadModule('/src/features/rentals/hooks/useProviderRequests.js')).default
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('admin accepts a request only after confirming the account password', async () => {
  let decided
  adminApi({ snapshot: () => [booking()], onDecision: (url, body) => { decided = { url, body } } })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(AdminPage, { user: { id: 'admin', username: 'Admin' }, token: 'test-session', onLogout: () => {} }))
  await user.click(within(screen.getByRole('navigation', { name: 'Admin sections' })).getByRole('button', { name: /Rental requests/ }))
  assert.ok(await screen.findByRole('heading', { name: 'New camera request' }))
  await user.click(screen.getByRole('button', { name: 'Accept', exact: true }))
  assert.equal(decided, undefined, 'nothing is sent before the password is entered')
  await user.type(screen.getByLabelText('Account password'), 'Admin-password-1')
  await user.click(screen.getByRole('button', { name: 'Confirm and accept' }))
  await waitFor(() => assert.deepEqual(decided, { url: '/api/provider/requests/request-1/items/item-1', body: { decision: 'accepted', password: 'Admin-password-1' } }))
})

test('a locked approval keeps the confirm button disabled and shows the server message', async () => {
  const api = async () => { throw Object.assign(new Error('Too many incorrect passwords. Try again in 10 minute(s).'), { code: 'APPROVAL_LOCKED', retryAfter: 600 }) }
  const RentalDecisionDialog = (await vite.ssrLoadModule('/src/features/rentals/components/RentalDecisionDialog.jsx')).default
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalDecisionDialog, { target: { requestId: 'request-1', productId: 'item-1', title: 'Camera', decision: 'accepted' }, api, onClose: () => {}, onDecided: () => {} }))
  await user.type(screen.getByLabelText('Account password'), 'wrong-password')
  await user.click(screen.getByRole('button', { name: 'Confirm and accept' }))
  assert.match((await screen.findByRole('alert')).textContent, /Try again in 10 minute/)
  assert.equal(screen.getByRole('button', { name: 'Approvals locked' }).disabled, true)
})

test('new admin requests appear on window focus even when an unrelated dashboard endpoint fails', async () => {
  let current = []
  adminApi({ snapshot: () => current, failOverview: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(AdminPage, { user: { id: 'admin', username: 'Admin' }, token: 'test-session', onLogout: () => {} }))
  await user.click(within(screen.getByRole('navigation', { name: 'Admin sections' })).getByRole('button', { name: /Rental requests/ }))
  await screen.findByText('There are no customer rental requests for your items yet.')
  current = [booking()]
  await act(async () => window.dispatchEvent(new dom.window.Event('focus')))
  assert.ok(await screen.findByRole('heading', { name: 'New camera request' }))
  assert.ok(screen.getByRole('button', { name: 'Accept', exact: true }))
})

test('shop bookings refresh on focus and still render if inventory loading fails', async () => {
  let current = []
  const api = async (url) => { if (url === '/api/provider/requests') return { requests: current }; throw new Error('Inventory temporarily unavailable.') }
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(OwnerHome, { user: { id: 'shop-1', username: 'Shop' }, api, onLogout: () => {} }))
  await user.click(within(screen.getByRole('navigation', { name: 'Owner workspace' })).getByRole('button', { name: /Bookings/ }))
  await waitFor(() => assert.ok(screen.getAllByRole('alert').some((notice) => notice.textContent === 'Inventory temporarily unavailable.')))
  current = [booking()]
  await act(async () => window.dispatchEvent(new dom.window.Event('focus')))
  assert.ok(await screen.findByRole('heading', { name: 'New camera request' }))
  assert.ok(screen.getByRole('button', { name: 'Accept' }))
})

function Feed({ api }) {
  const { requests, error, refresh } = useProviderRequests(api)
  return React.createElement('section', null, requests.map((row) => React.createElement('p', { key: row._id }, row.items[0].title)), error && React.createElement('p', { role: 'alert' }, error), React.createElement('button', { onClick: refresh }, 'Refresh feed'))
}

test('a stale response cannot replace a newer request list', async () => {
  const pending = []
  const api = (_url, options) => new Promise((resolve) => pending.push({ resolve, signal: options.signal }))
  render(React.createElement(Feed, { api }))
  await waitFor(() => assert.equal(pending.length, 1))
  await act(async () => window.dispatchEvent(new dom.window.Event('focus')))
  assert.equal(pending[0].signal.aborted, true)
  await act(async () => pending[1].resolve({ requests: [booking()] }))
  assert.ok(await screen.findByText('New camera request'))
  await act(async () => pending[0].resolve({ requests: [] }))
  assert.ok(screen.getByText('New camera request'))
})

test('request polling refreshes visible pages and pauses while the page is hidden', async () => {
  const originalInterval = window.setInterval, originalClear = window.clearInterval
  let poll, calls = 0, current = []
  window.setInterval = (callback, interval) => { assert.equal(interval, 15000); poll = callback; return 123 }
  window.clearInterval = () => {}
  try {
    const api = async () => { calls += 1; return { requests: current } }
    const view = render(React.createElement(Feed, { api }))
    await waitFor(() => assert.equal(calls, 1))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    await act(async () => poll())
    assert.equal(calls, 1)
    current = [booking()]
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => poll())
    assert.ok(await screen.findByText('New camera request'))
    view.unmount()
  } finally {
    window.setInterval = originalInterval; window.clearInterval = originalClear
    delete document.visibilityState
  }
})

test('request refresh failures retain the last successful list and allow retry', async () => {
  let failing = false
  const api = async () => { if (failing) throw new Error('Request refresh unavailable.'); return { requests: [booking()] } }
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(Feed, { api }))
  await screen.findByText('New camera request')
  failing = true
  await user.click(screen.getByRole('button', { name: 'Refresh feed' }))
  assert.ok(await screen.findByRole('alert'))
  assert.ok(screen.getByText('New camera request'))
  failing = false
  await user.click(screen.getByRole('button', { name: 'Refresh feed' }))
  await waitFor(() => assert.equal(screen.queryByRole('alert'), null))
})
