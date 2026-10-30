import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'
import { preferLatestRental } from '../src/features/rentals/utils/customerRental.js'
import { readJsonResponse } from '../src/services/http.js'

let vite, CustomerRentals, render, screen, within, waitFor, cleanup, act, userEvent, axe
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>RentEase customer rentals</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }

const fixture = (overrides = {}) => ({
  _id: '67abcd123456789000000001', status: 'confirmed', customerId: 'customer-1',
  items: [{ productId: 'camera-1', title: 'Sony A7 IV camera', decision: 'accepted', depositAmount: 5000, rentalAmount: 2500 }],
  startDate: '2026-11-10T00:00:00Z', endDate: '2026-11-12T00:00:00Z', createdAt: '2026-11-01T10:00:00Z',
  total: 2750, subtotal: 2500, deliveryFee: 250, deliveryMethod: 'pickup', statusHistory: [],
  payment: { status: 'authorized', provider: 'sandbox', rentalPaid: 2750, depositHeld: 5000, paidAt: '2026-11-02T10:00:00Z' },
  ...overrides,
})

function setup(rentals = [fixture()], options = {}) {
  let current = rentals
  const calls = []
  const props = {
    initialRentals: rentals, user: { email: 'asha@example.test', username: 'Asha' }, token: 'current-session',
    products: [{ _id: 'camera-1', category: 'Camera equipment', photos: ['/camera.jpg'] }],
    onBrowse: () => calls.push({ action: 'browse' }), onMessages: () => calls.push({ action: 'messages' }),
    api: async (path, settings = {}) => {
      calls.push({ path, settings })
      if (path === '/api/requests') {
        if (options.failLoad) throw new Error('Network unavailable')
        return { requests: current }
      }
      if (path.includes('/pickup')) {
        const booking = current.find((rental) => path.includes(rental._id))
        const challenge = { challengeId: '00000000-0000-4000-8000-000000000000', maskedEmail: 'a***@example.test', expiresAt: new Date(Date.now() + (options.expired ? -1000 : 300000)).toISOString(), resendAt: new Date(Date.now() + (options.allowResend ? -1000 : 60000)).toISOString(), serverTime: new Date().toISOString() }
        if (!settings.method) return options.resume ? { ...challenge, pickupVerification: { status: 'pending' } } : { pickupVerification: { status: 'not_started' } }
        if (path.endsWith('/send')) {
          if (options.failEmail || (options.failResend && calls.filter((call) => call.path?.endsWith('/pickup/send')).length > 1)) throw Object.assign(new Error('Email unavailable. Please retry.'), { code: 'EMAIL_FAILED', retryAfter: 60 })
          return challenge
        }
        if (options.invalidOtp) throw Object.assign(new Error('The code is incorrect.'), { code: 'OTP_INCORRECT' })
        const updated = { ...booking, updatedAt: new Date().toISOString(), pickupVerification: { status: 'customer_verified', customerVerifiedAt: new Date().toISOString() } }
        current = current.map((rental) => rental._id === updated._id ? updated : rental)
        return { rental: updated, message: 'Email verified. Awaiting administrator physical handover.' }
      }
      if (!settings.method) {
        if (options.failDetails) throw new Error('This rental booking is not available.')
        const booking = current.find((rental) => path === `/api/requests/${rental._id}`)
        return { rental: booking ? { ...booking, items: booking.items.map((item) => ({ quantity: 1, ...item, product: item.product || { category: 'Camera equipment', description: 'A mirrorless camera with lens and carry case.', photos: ['/camera-front.jpg', '/camera-back.jpg'], specifications: [{ name: 'Resolution', value: '33 megapixels' }] } })) } : null }
      }
      if (options.failAction) throw new Error('The server could not confirm this action. Please try again.')
      const original = current.find((rental) => path.includes(rental._id))
      const updated = path.endsWith('/payments') ? { ...original, payment: { ...original.payment, status: 'authorized', paidAt: new Date().toISOString(), depositHeld: 5000 }, invoiceNumber: 'RE-TEST-001' } : { ...original, status: 'cancelled', updatedAt: new Date().toISOString(), cancelledAt: new Date().toISOString(), cancellationReason: JSON.parse(settings.body).reason || '' }
      current = current.map((rental) => rental._id === updated._id ? updated : rental)
      return { request: updated, message: path.endsWith('/payments') ? 'Sandbox payment confirmed.' : 'Booking cancelled.' }
    },
  }
  return { props, calls, setRentals: (value) => { current = value } }
}

before(async () => {
  ;({ render, screen, within, waitFor, cleanup, act } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  axe = (await import('axe-core')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  CustomerRentals = (await vite.ssrLoadModule('/src/features/rentals/pages/CustomerRentals.jsx')).default
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('booked customers see receipt code guidance without shop handover controls', async () => {
  const { props } = setup()
  render(React.createElement(CustomerRentals, props))
  assert.ok(await screen.findByRole('heading', { name: 'You’re ready for pickup' }))
  assert.ok(screen.getByText('a***@example.test'))
  assert.ok(screen.getByText(/shop sends a six-digit code to your email and private inbox/))
  assert.equal(screen.queryByRole('textbox', { name: /Code digit/ }), null)
  assert.equal(screen.queryByRole('button', { name: /Verify pickup|Send pickup OTP/ }), null)
  assert.equal(screen.queryByRole('button', { name: 'Review payment' }), null)
})

test('active customers see recorded pickup evidence and separate return-code instructions', async () => {
  const rental = fixture({ status: 'active', pickupVerifiedAt: '2026-11-10T09:12:00Z' })
  const { props } = setup([rental])
  render(React.createElement(CustomerRentals, props))
  assert.ok(await screen.findByRole('heading', { name: 'Enjoy your rental' }))
  assert.ok(screen.getByText(/Choose self return or rider collection/))
  const progress = screen.getByRole('list', { name: 'Rental progress' })
  assert.equal(progress.querySelectorAll('.is-complete').length, 3)
  assert.equal(screen.queryByRole('button', { name: 'Cancel booking' }), null)
})

test('historical active rentals never display an invented verified pickup timestamp', async () => {
  const { props } = setup([fixture({ status: 'active' })])
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.click(screen.getByText('Booking & payment details'))
  assert.ok(screen.getByText('No verified pickup recorded yet'))
  assert.equal(screen.getByRole('list', { name: 'Rental progress' }).querySelectorAll('.is-complete').length, 2)
})

test('payment opens a transparent confirmation and submits only after confirmation', async () => {
  const { props, calls } = setup([fixture({ payment: { status: 'unpaid' } })])
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.click(await screen.findByRole('button', { name: 'Review payment' }))
  const dialog = screen.getByRole('dialog')
  assert.ok(within(dialog).getByText('Sandbox payments are enabled. No real money will be charged.'))
  assert.ok(within(dialog).getByText('LKR 7,750'))
  assert.equal(calls.filter((call) => call.path?.endsWith('/payments')).length, 0)
  await user.click(within(dialog).getByRole('button', { name: 'Confirm test payment' }))
  assert.ok(await screen.findByRole('status'))
  assert.ok(await screen.findByRole('heading', { name: 'You’re ready for pickup' }))
  const payment = calls.find((call) => call.path?.endsWith('/payments'))
  assert.equal(payment.settings.method, 'POST')
  assert.match(payment.settings.headers['Idempotency-Key'], /^[a-f0-9-]{36}$/)
})

test('payment failures keep the booking unchanged and reuse the same retry key', async () => {
  const { props, calls } = setup([fixture({ payment: { status: 'unpaid' } })], { failAction: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.click(await screen.findByRole('button', { name: 'Review payment' }))
  await user.click(screen.getByRole('button', { name: 'Confirm test payment' }))
  assert.ok(await screen.findByRole('alert'))
  assert.equal(screen.queryByRole('heading', { name: 'You’re ready for pickup' }), null)
  await user.click(screen.getByRole('button', { name: 'Confirm test payment' }))
  const payments = calls.filter((call) => call.path?.endsWith('/payments'))
  assert.equal(payments.length, 2)
  assert.equal(payments[0].settings.headers['Idempotency-Key'], payments[1].settings.headers['Idempotency-Key'])
})

test('cancellation requires confirmation; keeping the booking restores focus without posting', async () => {
  const { props, calls } = setup()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  const trigger = screen.getByRole('button', { name: 'Cancel booking' })
  await user.click(trigger)
  assert.ok(screen.getByRole('dialog', { name: 'Cancel this booking?' }))
  await user.click(screen.getByRole('button', { name: 'Keep my booking' }))
  assert.equal(screen.queryByRole('dialog'), null)
  assert.equal(calls.filter((call) => call.settings?.method === 'POST').length, 0)
  assert.ok(document.activeElement === trigger)
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'Yes, cancel booking' }))
  assert.ok(await screen.findByRole('heading', { name: 'This booking was cancelled' }))
})

test('returned bookings show verified completion, retained fees, and the actual deposit release', async () => {
  const rental = fixture({ status: 'returned', pickupVerifiedAt: '2026-11-10T09:12:00Z', returnVerifiedAt: '2026-11-12T09:05:00Z', payment: { status: 'partially_refunded', depositHeld: 5000, depositRefunded: 4000, refundedAt: '2026-11-12T10:00:00Z', adjustments: [{ type: 'damage_fee', amount: 1000, note: 'Lens hood replacement' }] } })
  const { props } = setup([rental])
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  assert.ok(await screen.findByRole('heading', { name: 'Return verified. Thank you!' }))
  assert.ok(screen.getByText('LKR 4,000 released'))
  await user.click(screen.getByText('Booking & payment details'))
  assert.ok(screen.getByText('Damage fee'))
  assert.ok(screen.getByText('Lens hood replacement'))
  assert.equal(screen.getByRole('list', { name: 'Rental progress' }).querySelectorAll('.is-complete').length, 4)
})

test('search and rental groups filter actual bookings and can reset to all rentals', async () => {
  const { props } = setup([fixture(), fixture({ _id: '67abcd123456789000000099', status: 'returned', items: [{ productId: 'tent-1', title: 'Camping tent', decision: 'accepted' }] })])
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.click(screen.getByRole('button', { name: /Past rentals/ }))
  assert.equal(screen.queryByRole('heading', { name: 'Sony A7 IV camera' }), null)
  assert.ok(screen.getByRole('heading', { name: 'Camping tent' }))
  await user.type(screen.getByRole('searchbox'), 'camera')
  assert.ok(screen.getByText('No rentals match this view'))
  await user.click(screen.getByRole('button', { name: 'Show all rentals' }))
  assert.ok(screen.getByRole('heading', { name: 'Sony A7 IV camera' }))
})

test('window focus refreshes handover progress after administrator verification', async () => {
  const { props, setRentals } = setup()
  render(React.createElement(CustomerRentals, props))
  await screen.findByRole('heading', { name: 'You’re ready for pickup' })
  setRentals([fixture({ status: 'active', pickupVerifiedAt: new Date().toISOString() })])
  await act(async () => { window.dispatchEvent(new dom.window.Event('focus')) })
  assert.ok(await screen.findByRole('heading', { name: 'Enjoy your rental' }))
})

test('refresh failure retains the last loaded booking and shows a retry action', async () => {
  const { props } = setup([fixture()], { failLoad: true })
  render(React.createElement(CustomerRentals, props))
  assert.ok(await screen.findByRole('alert'))
  assert.ok(screen.getByRole('heading', { name: 'Sony A7 IV camera' }))
  assert.ok(screen.getByRole('button', { name: 'Refresh rentals' }))
})

test('invoice downloads authenticate with the current prop token, not local storage', async () => {
  const { props } = setup([fixture({ invoiceNumber: 'RE-INVOICE-1' })])
  const user = userEvent.setup({ document: dom.window.document })
  const originalFetch = globalThis.fetch, originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL
  const anchorClick = dom.window.HTMLAnchorElement.prototype.click
  let authorization, downloaded = false
  globalThis.fetch = async (_path, options) => { authorization = options.headers.Authorization; return { ok: true, blob: async () => new Blob(['%PDF-1.4']) } }
  URL.createObjectURL = () => 'blob:test-invoice'
  URL.revokeObjectURL = () => {}
  dom.window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download === 'RE-INVOICE-1.pdf' }
  try {
    render(React.createElement(CustomerRentals, props))
    await user.click(await screen.findByRole('button', { name: 'Invoice PDF' }))
    await waitFor(() => assert.ok(downloaded))
    assert.equal(authorization, 'Bearer current-session')
  } finally { globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; dom.window.HTMLAnchorElement.prototype.click = anchorClick }
})

test('customer booking view and payment dialog pass structural accessibility checks', async () => {
  const { props } = setup([fixture({ payment: { status: 'unpaid' } })])
  const user = userEvent.setup({ document: dom.window.document })
  const { container } = render(React.createElement(CustomerRentals, props))
  await screen.findByRole('button', { name: 'Review payment' })
  const dashboard = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(dashboard.violations.map((violation) => violation.id), [])
  await user.click(screen.getByRole('button', { name: 'Review payment' }))
  const modal = await axe.run(screen.getByRole('dialog'), { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(modal.violations.map((violation) => violation.id), [])
})

test('clicking a rental card retrieves its complete details through the customer API', async () => {
  const { props, calls } = setup()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.click(screen.getByRole('article', { name: 'Sony A7 IV camera' }))
  const dialog = await screen.findByRole('dialog', { name: 'Booking RE-00000001' })
  assert.ok(await within(dialog).findByText('A mirrorless camera with lens and carry case.'))
  assert.ok(within(dialog).getByText('33 megapixels'))
  assert.ok(within(dialog).getByText('2 days'))
  assert.ok(within(dialog).getByText('Payment method'))
  assert.ok(calls.some((call) => call.path === '/api/requests/67abcd123456789000000001'))
  assert.equal(within(dialog).queryByRole('button', { name: 'Verify pickup' }), null)
})

test('cards open with Enter or Space and return focus to the card when details close', async () => {
  const { props } = setup()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  const card = screen.getByRole('article', { name: 'Sony A7 IV camera' })
  card.focus(); await user.keyboard('{Enter}')
  assert.ok(await screen.findByRole('dialog', { name: 'Booking RE-00000001' }))
  await user.click(screen.getByRole('button', { name: 'Close rental details' }))
  await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
  assert.ok(document.activeElement === card)
  await user.keyboard(' ')
  assert.ok(await screen.findByRole('dialog', { name: 'Booking RE-00000001' }))
})

test('view-details action opens galleries, image selection, multiple items, and the full lifecycle', async () => {
  const second = { productId: 'tent-1', title: 'Camping tent', rentalAmount: 1500, decision: 'accepted', product: { category: 'Outdoors', description: 'Two-person waterproof tent.', photos: ['/tent.jpg'], specifications: [] } }
  const booking = fixture({ items: [...fixture().items, second] })
  const { props } = setup([booking])
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.click(screen.getByRole('button', { name: 'View details for RE-00000001' }))
  const dialog = await screen.findByRole('dialog')
  assert.ok(await within(dialog).findByText('Two-person waterproof tent.'))
  await user.click(within(dialog).getByRole('button', { name: 'Show Sony A7 IV camera photo 2' }))
  assert.ok(within(dialog).getByRole('img', { name: 'Sony A7 IV camera, photo 2' }).src.endsWith('/camera-back.jpg'))
  const lifecycle = within(dialog).getByRole('list', { name: 'Detailed rental lifecycle' })
  assert.equal(lifecycle.children.length, 5)
  assert.equal(lifecycle.querySelectorAll('.is-complete').length, 1)
})

test('an open detail panel refreshes verification timestamps and its timeline after admin changes', async () => {
  const { props, setRentals } = setup()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.click(screen.getByRole('button', { name: /View details for/ }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByRole('list', { name: 'Detailed rental lifecycle' })
  setRentals([fixture({ status: 'returned', pickupVerifiedAt: '2026-11-10T09:12:00Z', returnVerifiedAt: '2026-11-12T09:05:00Z' })])
  await act(async () => { window.dispatchEvent(new dom.window.Event('focus')) })
  await waitFor(() => assert.equal(within(dialog).getByRole('list', { name: 'Detailed rental lifecycle' }).querySelectorAll('.is-complete').length, 5))
  assert.ok(within(dialog).getByText('Return:').textContent.includes('Verified'))
})

test('detail errors provide retry and never present an unverified response as booking data', async () => {
  const { props } = setup([fixture()], { failDetails: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.click(screen.getByRole('button', { name: /View details for/ }))
  const dialog = screen.getByRole('dialog')
  assert.ok(await within(dialog).findByRole('alert'))
  assert.ok(within(dialog).getByRole('button', { name: 'Try again' }))
  assert.equal(within(dialog).queryByRole('heading', { name: 'Payment details' }), null)
})

test('awaiting-pickup status filtering is derived from the real confirmed payment state', async () => {
  const { props } = setup([fixture(), fixture({ _id: '67abcd123456789000000099', payment: { status: 'unpaid' }, items: [{ productId: 'tent-1', title: 'Camping tent', decision: 'accepted' }] })])
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.selectOptions(screen.getByRole('combobox', { name: 'Rental status' }), 'awaiting_pickup')
  assert.ok(screen.getByRole('heading', { name: 'Sony A7 IV camera' }))
  assert.equal(screen.queryByRole('heading', { name: 'Camping tent' }), null)
  assert.ok(screen.getByText('Awaiting pickup', { selector: 'span' }))
})

test('empty customers can browse items and the complete details dialog passes structural accessibility checks', async () => {
  const empty = setup([])
  const user = userEvent.setup({ document: dom.window.document })
  const first = render(React.createElement(CustomerRentals, empty.props))
  await user.click(await screen.findByRole('button', { name: 'Explore rental items' }))
  assert.ok(empty.calls.some((call) => call.action === 'browse'))
  first.unmount()
  const { props } = setup()
  render(React.createElement(CustomerRentals, props))
  await user.click(screen.getByRole('button', { name: /View details for/ }))
  const dialog = await screen.findByRole('dialog')
  await within(dialog).findByText('33 megapixels')
  const result = await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(result.violations.map((violation) => violation.id), [])
})

test('pending self pickup shows recipient guidance and never calls customer send or verify APIs', async () => {
  const { props, calls } = setup([fixture({ pickupVerification: { status: 'pending' } })])
  render(React.createElement(CustomerRentals, props))
  assert.ok(await screen.findByText(/Share it with the shop after receiving your items/))
  assert.equal(screen.queryByRole('button', { name: /Continue verification|Verify pickup|Send OTP/ }), null)
  assert.equal(calls.filter((c) => c.path?.includes('/pickup/send') || c.path?.includes('/pickup/verify')).length, 0)
})

test('cancelled bookings retain reason and time but never show pickup, return or cancellation controls', async () => {
  const { props, calls } = setup([fixture({ status: 'cancelled', cancelledAt: '2026-11-05T09:00:00Z', cancellationReason: 'Trip postponed', pickupVerification: { status: 'pending' } })])
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  assert.ok(await screen.findByText('Reason: Trip postponed'))
  assert.ok(!screen.queryByRole('button', { name: /Verify pickup|Continue verification|Verify return|Cancel booking/ }))
  await user.click(screen.getByRole('button', { name: /View details for/ }))
  const dialog = screen.getByRole('dialog')
  assert.ok(await within(dialog).findByText('Reason: Trip postponed'))
  assert.equal(calls.filter((call) => call.settings?.method === 'POST').length, 0)
})

test('cancellation from details posts an optional reason and refreshes the open detail panel', async () => {
  const { props, calls } = setup()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CustomerRentals, props))
  await user.click(screen.getByRole('button', { name: /View details for/ }))
  const details = screen.getByRole('dialog')
  await within(details).findByText('33 megapixels')
  await user.click(within(details).getByRole('button', { name: 'Cancel booking' }))
  const confirm = screen.getByRole('dialog', { name: 'Cancel this booking?' })
  await user.type(within(confirm).getByRole('textbox', { name: 'Reason (optional)' }), 'Schedule changed')
  await user.click(within(confirm).getByRole('button', { name: 'Yes, cancel booking' }))
  assert.ok(await within(details).findByText('Reason: Schedule changed'))
  assert.equal(JSON.parse(calls.find((call) => call.path?.endsWith('/cancel')).settings.body).reason, 'Schedule changed')
  assert.ok(!within(details).queryByRole('button', { name: 'Cancel booking' }))
})

test('server cancellation cutoff hides the action while the booking remains visible', async () => {
  const { props } = setup([fixture({ cancellation: { allowed: false, reason: 'Inside cancellation cutoff.' } })])
  render(React.createElement(CustomerRentals, props))
  assert.ok(await screen.findByRole('heading', { name: 'Sony A7 IV camera' }))
  assert.ok(!screen.queryByRole('button', { name: 'Cancel booking' }))
})

test('JSON errors preserve OTP codes and retry-after metadata for the customer dialog', async () => {
  await assert.rejects(readJsonResponse(new Response(JSON.stringify({ message: 'Wait before resending.', code: 'OTP_COOLDOWN', retryAfter: 60 }), { status: 429, headers: { 'content-type': 'application/json' } })), (error) => error.code === 'OTP_COOLDOWN' && error.retryAfter === 60 && error.status === 429)
})

test('an older polling snapshot cannot replace a newer verified rental', () => {
  const fresh = fixture({ status: 'active', pickupVerifiedAt: '2026-11-10T09:12:00Z', updatedAt: '2026-11-10T09:12:00Z' })
  const stale = fixture({ status: 'confirmed', updatedAt: '2026-11-10T09:00:00Z' })
  assert.equal(preferLatestRental(fresh, stale), fresh)
  assert.equal(preferLatestRental(stale, fresh), fresh)
})
