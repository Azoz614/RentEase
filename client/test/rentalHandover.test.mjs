import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, RentalHandover, render, screen, within, waitFor, cleanup, userEvent, axe
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>RentEase test</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
// jsdom does not implement the native modal API; the real app uses the browser's dialog focus trap.
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }

const fixture = () => ({ _id: '67abcd123456789000000001', customerId: { username: 'Asha Perera', maskedEmail: 'a***@example.test', phone: '0701234567' }, items: [{ productId: '67abcd123456789000000002', title: 'Sony A7 IV', decision: 'accepted', rentalAmount: 2500 }], startDate: new Date().toISOString(), endDate: new Date(Date.now() + 86400000).toISOString(), total: 2500, status: 'confirmed', payment: { status: 'authorized' }, createdAt: new Date().toISOString(), statusHistory: [] })
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
function installApi({ invalid = false, emailFailure = false, status = 'confirmed', empty = false, customerVerified = false, failConfirmation = false, preparation = false, returnVerified = false } = {}) {
  const rental = fixture(); rental.status = status
  rental.requiresPickupPreparation = preparation
  if (returnVerified) rental.returnOtpVerifiedAt = new Date().toISOString()
  if (customerVerified) rental.pickupVerification = { status: 'customer_verified', customerVerifiedAt: new Date().toISOString() }
  if (status === 'active') rental.pickupVerifiedAt = new Date().toISOString()
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (String(url).endsWith('/ready')) {
      rental.readyForPickupAt = new Date().toISOString()
      return response({ message: 'Rental is ready for pickup.' })
    }
    if (String(url).endsWith('/return/confirm')) {
      rental.status = 'returned'; rental.returnVerifiedAt = new Date().toISOString()
      return response({ message: 'Return receipt and inspection recorded.' })
    }
    if (String(url).endsWith('/complete')) {
      rental.status = 'completed'
      return response({ message: 'Rental completed.' })
    }
    if (String(url).endsWith('/handover/confirm')) {
      if (failConfirmation) return response({ message: 'The rental was cancelled. Refresh before continuing.' }, 409)
      rental.status = 'active'; rental.pickupVerifiedAt = new Date().toISOString()
      return response({ message: 'Physical handover confirmed. Rental is now on rental.' })
    }
    if (String(url).includes('/send')) {
      if (emailFailure) return response({ message: 'The verification email could not be delivered.', code: 'EMAIL_FAILED', retryAfter: 60 }, 502)
      return response({ challengeId: '00000000-0000-4000-8000-000000000000', maskedEmail: 'a***@example.test', expiresAt: new Date(Date.now() + 300000).toISOString(), resendAt: new Date(Date.now() + 60000).toISOString(), serverTime: new Date().toISOString() })
    }
    if (String(url).includes('/verify')) {
      if (invalid) return response({ message: 'The verification code is incorrect. Please try again.', code: 'OTP_INCORRECT' }, 400)
      rental.status = status === 'active' ? 'returned' : 'active'
      if (rental.status === 'active') rental.pickupVerifiedAt = new Date().toISOString()
      else rental.returnVerifiedAt = new Date().toISOString()
      return response({ message: rental.status === 'active' ? 'Pickup verified successfully. Rental is now active.' : 'Return verified successfully. Rental has been marked as returned.' })
    }
    if (String(url).includes('/rentals?')) return response({ rentals: empty ? [] : [{ ...rental }], total: empty ? 0 : 1, pages: 1, stats: { total: empty ? 0 : 1, awaitingPickup: rental.status === 'confirmed' ? 1 : 0, onRental: rental.status === 'active' ? 1 : 0, returned: rental.status === 'returned' ? 1 : 0 } })
    return response({ rental: { ...rental } })
  }
  return calls
}

before(async () => {
  ;({ render, screen, within, waitFor, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  axe = (await import('axe-core')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  RentalHandover = (await vite.ssrLoadModule('/src/features/rentals/pages/RentalHandover.jsx')).default
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('new paid bookings require an explicit readiness confirmation before exposing pickup verification', async () => {
  const calls = installApi({ preparation: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  await user.click(await screen.findByRole('button', { name: 'Mark ready for pickup' }))
  const dialog = screen.getByRole('dialog', { name: 'Mark rental ready for pickup' })
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 0)
  await user.click(within(dialog).getByRole('button', { name: 'Confirm ready for pickup' }))
  assert.ok(await screen.findByRole('button', { name: 'Verify pickup' }))
  assert.equal(calls.filter((call) => call.url.endsWith('/ready')).length, 1)
})

test('return receipt requires inspection notes and completion is a separate confirmed action', async () => {
  const calls = installApi({ status: 'active', returnVerified: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  await user.click(await screen.findByRole('button', { name: 'Confirm return & inspect' }))
  const dialog = screen.getByRole('dialog', { name: 'Confirm return and inspection' })
  await user.click(within(dialog).getByRole('button', { name: 'Confirm receipt and inspection' }))
  assert.equal(calls.filter((call) => call.url.endsWith('/return/confirm')).length, 0)
  await user.type(within(dialog).getByRole('textbox', { name: 'Inspection notes' }), 'All items received and inspected without visible damage.')
  await user.click(within(dialog).getByRole('button', { name: 'Confirm receipt and inspection' }))
  const completion = await screen.findByRole('button', { name: 'Complete rental' })
  assert.match(JSON.parse(calls.find((call) => call.url.endsWith('/return/confirm')).options.body).inspectionNote, /inspected/)
  await user.click(completion)
  await user.click(screen.getByRole('button', { name: 'Confirm completion' }))
  assert.ok(await screen.findByText('Completed', { selector: '.handover-status' }))
  assert.equal(calls.filter((call) => call.url.endsWith('/complete')).length, 1)
})

test('customer-verified bookings require explicit physical handover confirmation without another OTP', async () => {
  const calls = installApi({ customerVerified: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  await user.click(await screen.findByRole('button', { name: 'Confirm handover' }))
  const dialog = screen.getByRole('dialog', { name: 'Confirm physical handover' })
  assert.ok(within(dialog).getByText('Sony A7 IV'))
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 0)
  await user.click(within(dialog).getByRole('button', { name: 'Confirm items handed over' }))
  assert.ok(await screen.findByText('On rental', { selector: '.handover-status' }))
  assert.equal(calls.filter((call) => call.url.endsWith('/handover/confirm')).length, 1)
  assert.equal(calls.filter((call) => call.url.includes('/send')).length, 0)
})

test('failed physical handover keeps the rental booked and shows the backend error', async () => {
  installApi({ customerVerified: true, failConfirmation: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  await user.click(await screen.findByRole('button', { name: 'Confirm handover' }))
  await user.click(screen.getByRole('button', { name: 'Confirm items handed over' }))
  assert.ok(await screen.findByRole('alert'))
  assert.ok(!screen.queryByText('On rental', { selector: '.handover-status' }))
})

test('cancelled rentals have no handover or return action in the admin list', async () => {
  installApi({ status: 'cancelled', customerVerified: true })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  assert.ok(await screen.findByText('Cancelled', { selector: '.handover-status' }))
  assert.ok(!screen.queryByRole('button', { name: /Verify pickup|Confirm handover|Verify return/ }))
})

test('dashboard renders counts, masked customer details, and only eligible pickup actions', async () => {
  installApi()
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  assert.ok(await screen.findByRole('button', { name: 'Verify pickup' }))
  assert.ok(screen.getByText('Asha Perera'))
  assert.ok(screen.getByText('a***@example.test'))
  assert.equal(screen.queryByRole('button', { name: 'Verify return' }), null)
  assert.ok(screen.getByText('Total bookings'))
})

test('OTP supports paste, advances focus, submits to the backend, and refreshes status after success', async () => {
  const calls = installApi()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  await user.click(await screen.findByRole('button', { name: 'Verify pickup' }))
  const digit = await screen.findByRole('textbox', { name: 'Code digit 1' })
  await waitFor(() => assert.equal(digit.disabled, false))
  await user.click(digit)
  await user.paste('654321')
  assert.equal(screen.getByRole('textbox', { name: 'Code digit 6' }).value, '1')
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Verify pickup', exact: true }))
  assert.ok(await screen.findByRole('heading', { name: 'Pickup verified' }))
  assert.ok(screen.getByText('On rental', { selector: 'span' }))
  const submission = calls.find((call) => call.url.endsWith('/verify'))
  assert.equal(JSON.parse(submission.options.body).code, '654321')
  assert.ok(submission.options.headers.Authorization.startsWith('Bearer '))
})

test('invalid code displays server feedback, clears fields, and never displays success', async () => {
  installApi({ invalid: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  await user.click(await screen.findByRole('button', { name: 'Verify pickup' }))
  const first = await screen.findByRole('textbox', { name: 'Code digit 1' })
  await waitFor(() => assert.equal(first.disabled, false))
  await user.click(first); await user.paste('654321')
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Verify pickup', exact: true }))
  assert.ok(await screen.findByRole('alert'))
  assert.match(screen.getByRole('alert').textContent, /incorrect/)
  assert.equal(screen.queryByRole('heading', { name: 'Pickup verified' }), null)
  assert.equal(first.value, '')
})

test('email failure keeps verification disabled and shows retry information', async () => {
  installApi({ emailFailure: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  await user.click(await screen.findByRole('button', { name: 'Verify pickup' }))
  assert.ok(await screen.findByText('The verification email could not be delivered.'))
  assert.equal(within(screen.getByRole('dialog')).getByRole('button', { name: 'Verify pickup', exact: true }).disabled, true)
  assert.ok(screen.getByRole('button', { name: /Resend in/ }).disabled)
})

test('active rentals show return verification and details show the progress timeline', async () => {
  installApi({ status: 'active' })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  assert.ok(await screen.findByRole('button', { name: 'Verify return' }))
  assert.equal(screen.queryByRole('button', { name: 'Verify pickup' }), null)
  await user.click(screen.getByRole('button', { name: /View rental/ }))
  assert.ok(await screen.findByRole('heading', { name: /#00000001/ }))
  assert.ok(screen.getByText('Picked up'))
  assert.ok(screen.getByRole('heading', { name: 'Activity history' }))
})

test('search and status filters are sent to the server; empty state is meaningful', async () => {
  const calls = installApi({ empty: true })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  assert.ok(await screen.findByText('Your rental orders will appear here'))
  await user.type(screen.getByRole('textbox', { name: 'Search rental orders' }), 'Sony')
  await user.selectOptions(screen.getByRole('combobox'), 'active')
  await waitFor(() => assert.ok(calls.some((call) => call.url.includes('q=Sony') && call.url.includes('status=active'))))
  assert.ok(await screen.findByText('No matching rentals'))
})

test('OTP modal has accessible labels and no detectable structural accessibility violations', async () => {
  installApi()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  await user.click(await screen.findByRole('button', { name: 'Verify pickup' }))
  const first = await screen.findByRole('textbox', { name: 'Code digit 1' })
  await waitFor(() => assert.equal(first.disabled, false))
  const dialog = screen.getByRole('dialog', { name: 'Verify Rental Pickup' })
  const results = await axe.run(dialog, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(results.violations.map((violation) => violation.id), [])
})

test('keyboard input advances between digits and arrow/backspace navigation works', async () => {
  installApi()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  await user.click(await screen.findByRole('button', { name: 'Verify pickup' }))
  const first = await screen.findByRole('textbox', { name: 'Code digit 1' })
  await waitFor(() => assert.equal(first.disabled, false))
  await user.click(first); await user.keyboard('1')
  const second = screen.getByRole('textbox', { name: 'Code digit 2' })
  assert.equal(dom.window.document.activeElement, second)
  await user.keyboard('{ArrowLeft}')
  assert.equal(dom.window.document.activeElement, first)
  await user.keyboard('{ArrowRight}{Backspace}')
  assert.equal(dom.window.document.activeElement, first)
  assert.equal(first.value, '1')
})

test('cancel closes the dialog without a verification call or rental status change', async () => {
  const calls = installApi()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(RentalHandover, { token: 'test-session' }))
  const trigger = await screen.findByRole('button', { name: 'Verify pickup' })
  await user.click(trigger)
  await screen.findByRole('dialog')
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => assert.ok(screen.queryByRole('dialog') === null))
  assert.equal(calls.filter((call) => call.url.endsWith('/verify')).length, 0)
  assert.ok(screen.getByText('Booked', { selector: 'span' }))
  assert.ok(dom.window.document.activeElement === trigger, 'Focus should return to the pickup button')
})

test('StrictMode does not send duplicate initial OTP emails', async () => {
  const calls = installApi()
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(React.StrictMode, null, React.createElement(RentalHandover, { token: 'test-session' })))
  await user.click(await screen.findByRole('button', { name: 'Verify pickup' }))
  const first = await screen.findByRole('textbox', { name: 'Code digit 1' })
  await waitFor(() => assert.equal(first.disabled, false))
  assert.equal(calls.filter((call) => call.url.endsWith('/send')).length, 1)
})
