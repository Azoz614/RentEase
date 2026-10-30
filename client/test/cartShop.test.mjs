import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, CartShopDialog, shop, render, screen, cleanup, userEvent
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Cart shop tests</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }

before(async () => {
  ;({ render, screen, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  CartShopDialog = (await vite.ssrLoadModule('/src/features/customer/components/CartShopDialog.jsx')).default
  shop = await vite.ssrLoadModule('/src/features/rentals/utils/rentalShop.js')
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('items are grouped by their populated, plain or legacy provider', () => {
  assert.equal(shop.providerOf({ providerId: { _id: 'shop-1', shopName: 'Lens Hub' } }), 'shop-1')
  assert.equal(shop.providerOf({ providerId: 'shop-1' }), 'shop-1')
  assert.equal(shop.providerOf({ createdBy: 'admin-1' }), 'admin-1')
  assert.equal(shop.shopNameOf({ providerId: { username: 'camera-co' } }), 'camera-co')
  assert.equal(shop.shopNameOf({}), 'RentEase')
})

test('the other-shop dialog keeps the request or starts a new one', async () => {
  const calls = []
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(CartShopDialog, {
    conflict: { product: { _id: 'p2', title: 'Drone' }, currentShop: 'Lens Hub', nextShop: 'Sky Rentals' },
    onKeep: () => calls.push('keep'), onStartNew: () => calls.push('new'),
  }))
  assert.ok(screen.getByRole('heading', { name: 'This item is from another shop' }))
  assert.match(document.body.textContent, /Your request has items from Lens Hub/)
  assert.match(document.body.textContent, /Drone is from Sky Rentals/)
  await user.click(screen.getByRole('button', { name: 'Keep my current request' }))
  await user.click(screen.getByRole('button', { name: 'Start a new request' }))
  assert.deepEqual(calls, ['keep', 'new'])
})
