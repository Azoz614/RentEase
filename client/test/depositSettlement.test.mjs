import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, DepositSettlement, render, screen, cleanup, userEvent, axe
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Deposit settlement</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, MutationObserver: dom.window.MutationObserver,
  FormData: dom.window.FormData, Event: dom.window.Event, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
const rental = (extra = {}) => ({ _id: 'rental-1', status: 'returned',
  payment: { status: 'authorized', depositHeld: 5000, adjustments: [] }, ...extra })

before(async () => {
  ;({ render, screen, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  axe = (await import('axe-core')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  DepositSettlement = (await vite.ssrLoadModule('/src/features/rentals/components/DepositSettlement.jsx')).DepositSettlement
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('shops record a fee against the deposit, then release the remainder after confirming', async () => {
  const calls = []; let reloads = 0
  const request = async (path, options) => { calls.push({ path, body: JSON.parse(options.body) }); return { message: 'Saved.' } }
  const { container } = render(React.createElement(DepositSettlement, { rental: rental(), request, onUpdated: async () => { reloads++ } }))
  const user = userEvent.setup({ document })
  await user.selectOptions(screen.getByLabelText('Fee type'), 'late_fee')
  await user.type(screen.getByLabelText('Amount (LKR)'), '1200')
  await user.type(screen.getByLabelText('Reason shown to the customer'), 'Returned one day late')
  await user.click(screen.getByRole('button', { name: 'Record fee' }))
  assert.deepEqual(calls[0], { path: '/api/provider/requests/rental-1/adjustments',
    body: { type: 'late_fee', amount: 1200, note: 'Returned one day late' } })
  await user.click(screen.getByRole('button', { name: 'Release deposit' }))
  assert.equal(calls.length, 1, 'releasing needs a second, explicit confirmation')
  await user.click(screen.getByRole('button', { name: /^Release LKR/ }))
  assert.equal(calls[1].path, '/api/provider/requests/rental-1/deposit/refund')
  assert.equal(reloads, 2)
  const report = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(report.violations.map((v) => v.id), [])
})

test('the deposit panel stays hidden when there is nothing the shop can settle', () => {
  const request = async () => ({})
  for (const value of [rental({ shared: true }), rental({ payment: { status: 'refunded', depositHeld: 5000 } }),
    rental({ payment: { status: 'authorized', depositHeld: 0 } })]) {
    const { container, unmount } = render(React.createElement(DepositSettlement, { rental: value, request, onUpdated: async () => {} }))
    assert.equal(container.textContent, ''); unmount()
  }
  render(React.createElement(DepositSettlement, { rental: rental({ status: 'active' }), request, onUpdated: async () => {} }))
  assert.equal(screen.queryByRole('button', { name: 'Release deposit' }), null, 'no release before the return is verified')
  assert.ok(screen.getByRole('button', { name: 'Record fee' }))
})
