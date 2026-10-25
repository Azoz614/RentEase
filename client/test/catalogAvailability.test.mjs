import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'
import { defaultRentalDates } from '../src/features/rentals/utils/rentalAvailability.js'

let vite, UserHome, render, screen, cleanup, waitFor, act, userEvent
const dom = new JSDOM('<!doctype html><html><head><title>Catalog availability</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }

function setup(initialStatus = 'available', identityStatus = 'approved') {
  let status = initialStatus
  const dates = defaultRentalDates()
  const calls = []
  let rental = { _id: '67abcd123456789000000001', status: 'confirmed', items: [{ productId: 'camera-1', title: 'Sony Camera', decision: 'accepted', rentalAmount: 2500 }], startDate: dates.startDate, endDate: dates.endDate, createdAt: new Date().toISOString(), total: 2500, subtotal: 2500, payment: { status: 'authorized' }, deliveryMethod: 'pickup', cancellation: { allowed: true } }
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    let body = {}
    if (String(url).startsWith('/api/products')) body = { products: [{ _id: 'camera-1', title: 'Sony Camera', description: 'Camera with lens', category: 'Electronics', location: 'Colombo', photos: ['/camera.jpg'], dailyRate: 2500, available: status === 'available', availabilityStatus: status }], nic: '200012345678', address: '12 Test Road, Colombo', mapsConfigured: false }
    else if (String(url) === '/api/requests') body = { requests: [rental] }
    else if (String(url).endsWith('/cancel')) { status = 'available'; rental = { ...rental, status: 'cancelled', updatedAt: new Date().toISOString() }; body = { request: rental, message: 'Booking cancelled.' } }
    else if (String(url) === '/api/inbox') body = { notifications: [] }
    else if (String(url) === '/api/wishlist') body = { products: [] }
    else if (['/api/identity/status', '/api/identity/profile'].includes(String(url))) body = { status: identityStatus, eligible: identityStatus === 'approved', maskedNic: '20••••678', fullName: 'Example Customer', phone: '0771234567', email: 'customer@example.test', history: [] }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { props: { user: { username: 'Asha', email: 'asha@example.test', role: 'user' }, token: 'test-session' }, calls, setAvailability: (value) => { status = value } }
}

before(async () => {
  ;({ render, screen, cleanup, waitFor, act } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  UserHome = (await vite.ssrLoadModule('/src/features/customer/pages/CustomerPage.jsx')).default
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('available items have valid default dates and can immediately be added to a request', async () => {
  const { props, calls } = setup()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(UserHome, props))
  const add = await screen.findByRole('button', { name: /Add to request/ })
  assert.equal(add.disabled, false)
  assert.ok(screen.getByLabelText('Until').value)
  const query = new URL(calls.find((call) => call.url.startsWith('/api/products')).url, 'http://localhost').searchParams
  assert.ok(new Date(query.get('endDate')) > new Date(query.get('startDate')))
  await user.click(add)
  assert.ok(screen.getByRole('button', { name: 'Added' }).disabled)
})

test('an unapproved customer is directed to verification instead of submitting a rental request', async () => {
  const { props, calls } = setup('available', 'pending')
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(UserHome, props))
  await user.click(await screen.findByRole('button', { name: /Add to request/ }))
  assert.ok(await screen.findByRole('heading', { name: 'Your submission is safely with the team' }))
  assert.equal(calls.filter((call) => call.url === '/api/requests' && call.options.method === 'POST').length, 0)
})

test('booked and on-rental items cannot be added', async () => {
  for (const state of ['booked', 'on_rental']) {
    const { props } = setup(state)
    const mounted = render(React.createElement(UserHome, props))
    const button = await screen.findByRole('button', { name: state === 'booked' ? 'Booked' : 'On rental' })
    assert.ok(button.disabled)
    mounted.unmount()
  }
})

test('after cancellation, returning to the catalog refreshes availability and enables requests', async () => {
  const { props, calls } = setup('booked')
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(UserHome, props))
  assert.ok((await screen.findByRole('button', { name: 'Booked' })).disabled)
  await user.click(screen.getByRole('button', { name: 'My rentals' }))
  await user.click(await screen.findByRole('button', { name: 'Cancel booking' }))
  await user.click(screen.getByRole('button', { name: 'Yes, cancel booking' }))
  assert.ok(await screen.findByRole('heading', { name: 'This booking was cancelled' }))
  const oldCatalogCalls = calls.filter((call) => call.url.startsWith('/api/products')).length
  await user.click(screen.getByRole('button', { name: 'Explore rentals' }))
  const add = await screen.findByRole('button', { name: /Add to request/ })
  assert.equal(add.disabled, false)
  assert.ok(calls.filter((call) => call.url.startsWith('/api/products')).length > oldCatalogCalls)
})

test('clearing a date gives an actionable date prompt rather than a permanently disabled add button', async () => {
  const { props } = setup()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(UserHome, props))
  await screen.findByRole('button', { name: /Add to request/ })
  await user.clear(screen.getByLabelText('Until'))
  const prompt = await screen.findByRole('button', { name: 'Choose rental dates' })
  assert.equal(prompt.disabled, false)
  await user.click(prompt)
  assert.ok(await screen.findByText(/Choose a return date after the start date/))
  assert.ok(document.activeElement === screen.getByLabelText('Until'))
})

test('refocusing the catalog refreshes new on-rental holds without reloading the page', async () => {
  const { props, setAvailability } = setup()
  render(React.createElement(UserHome, props))
  await screen.findByRole('button', { name: /Add to request/ })
  setAvailability('on_rental')
  await act(async () => { window.dispatchEvent(new dom.window.Event('focus')) })
  await waitFor(() => assert.ok(screen.getByRole('button', { name: 'On rental' }).disabled))
})
