import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, ReturnMethodDialog, DeliveryTaskBoard, render, screen, within, waitFor, cleanup, userEvent, axe
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Delivery verification</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, HTMLDialogElement: dom.window.HTMLDialogElement,
  MutationObserver: dom.window.MutationObserver, FormData: dom.window.FormData, Event: dom.window.Event,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
const pickup = { address: '12 Shop Road, Colombo', location: { type: 'Point', coordinates: [79.86, 6.92] } }
const destination = { address: '30 Customer Road, Colombo', location: { type: 'Point', coordinates: [79.88, 6.94] } }
const booking = { _id: 'booking-1', deliveryDestination: destination }
const task = (overrides = {}) => ({ id: 'task-1', rentalId: booking._id, direction: 'delivery', status: 'available',
  search: { state: 'waiting', radiusMeters: 2000 }, pickup, destination, shop: 'Camera shop',
  titles: ['Camera'], distanceKm: 4.2, etaMinutes: 12, fee: 210, rentalStatus: 'confirmed',
  paid: true, ready: true, history: [], ...overrides })
before(async () => {
  ;({ render, screen, within, waitFor, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  axe = (await import('axe-core')).default
  vite = await createServer({ envDir: 'test/fixtures', server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  ReturnMethodDialog = (await vite.ssrLoadModule('/src/features/rentals/components/ReturnMethodDialog.jsx')).default
  DeliveryTaskBoard = (await vite.ssrLoadModule('/src/features/delivery-partner/components/DeliveryTaskBoard.jsx')).default
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('self return requires a deliberate method, sends to the selected shop and lets the customer verify receipt', async () => {
  const calls = [], updates = []
  let closed = false
  const handover = { providerId: 'shop-1', name: 'Camera shop', status: 'not_started' }
  const api = async (path, options = {}) => {
    calls.push({ path, options })
    if (path.endsWith('/send')) Object.assign(handover, { status: 'sent', challengeId: 'challenge-1',
      maskedEmail: 's***@example.test', expiresAt: new Date(Date.now() + 300000), resendAt: new Date(Date.now() + 60000) })
    if (path.endsWith('/verify')) return { returned: true, message: 'Return verified.' }
    return { handovers: [{ ...handover }] }
  }
  render(React.createElement(ReturnMethodDialog, { rental: booking, api, onClose: () => { closed = true }, onUpdated: (m) => updates.push(m) }))
  const user = userEvent.setup({ document })
  assert.equal(calls.length, 0)
  await user.click(screen.getByRole('button', { name: /Self return/ }))
  await user.click(await screen.findByRole('button', { name: 'Send code to shop' }))
  assert.equal(JSON.parse(calls.find((c) => c.path.endsWith('/send')).options.body).providerId, 'shop-1')
  const input = await screen.findByRole('textbox', { name: 'Receipt code from Camera shop' })
  await user.type(input, '123456')
  await user.click(screen.getByRole('button', { name: 'Verify return receipt' }))
  await waitFor(() => assert.equal(closed, true))
  assert.equal(JSON.parse(calls.find((c) => c.path.endsWith('/verify')).options.body).challengeId, 'challenge-1')
  assert.equal(updates.length, 1)
})

test('partner return shows actual route and agreed fee before confirmation; selection alone never dispatches', async () => {
  const calls = []
  const api = async (path, options = {}) => {
    calls.push({ path, options })
    if (path.endsWith('/quote')) return { quoteToken: 'signed-quote', expiresAt: Date.now() + 300000, fee: 125,
      shipments: [{ providerId: 'shop-1', shopName: 'Camera shop', returnDistanceKm: 2.5, returnEtaMinutes: 9 }] }
    return { message: 'Collection requested.' }
  }
  render(React.createElement(ReturnMethodDialog, { rental: booking, api, onClose: () => {}, onUpdated: () => {} }))
  const user = userEvent.setup({ document })
  await user.click(screen.getByRole('button', { name: 'Delivery partner' }))
  assert.equal(calls.length, 0)
  await user.click(screen.getByRole('button', { name: 'Review collection route' }))
  assert.ok(await screen.findByText('2.50 km · 9 min'))
  assert.equal(calls.filter((c) => c.path.endsWith('/return')).length, 0)
  await user.click(screen.getByRole('button', { name: 'Confirm & find a return rider' }))
  assert.deepEqual(JSON.parse(calls.find((c) => c.path.endsWith('/return')).options.body), { quoteToken: 'signed-quote' })
})

test('customer explicitly assigns approved deliveries and sees accessible rider search progress', async () => {
  const calls = []
  let searching = false
  const api = async (path, options = {}) => {
    calls.push({ path, options })
    if (path.endsWith('/assign')) { searching = true; return { message: 'Finding nearby riders.' } }
    return { tasks: [task({ search: { state: searching ? 'searching' : 'waiting', radiusMeters: 2000 } })] }
  }
  const { container } = render(React.createElement(DeliveryTaskBoard, { api, role: 'user' }))
  const user = userEvent.setup({ document })
  await user.click(await screen.findByRole('button', { name: 'Assign Delivery Partner' }))
  assert.ok(await screen.findByText('Finding nearby riders'))
  assert.equal(calls.filter((c) => c.path.endsWith('/assign')).length, 1)
  const accessibility = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(accessibility.violations.map((v) => v.id), [])
})

test('shop collection codes are entered by shop staff; assigned riders can request but cannot verify them', async () => {
  const challenge = { id: 'shop-challenge', kind: 'shop_pickup', maskedEmail: 'r***@example.test',
    expiresAt: new Date(Date.now() + 300000), resendAt: new Date(Date.now() + 60000) }
  const api = async () => ({ tasks: [task({ status: 'assigned', canManage: true, canOperate: false, challenge })] })
  const staff = render(React.createElement(DeliveryTaskBoard, { api, role: 'rental_shop' }))
  assert.ok(await screen.findByRole('textbox', { name: 'Six-digit handover code' }))
  staff.unmount()
  const riderApi = async () => ({ tasks: [task({ status: 'assigned', canManage: false, canOperate: true, challenge })] })
  render(React.createElement(DeliveryTaskBoard, { api: riderApi, role: 'delivery_partner' }))
  await screen.findByText(/r\*\*\*@example.test/)
  assert.equal(screen.queryByRole('textbox', { name: 'Six-digit handover code' }), null)
})
