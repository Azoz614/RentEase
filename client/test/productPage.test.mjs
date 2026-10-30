import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, GuestBrowse, render, screen, waitFor, cleanup, userEvent
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Product page tests</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLElement.prototype.scrollTo = function () {}
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
const camera = { _id: '67abcd123456789000000002', title: 'Sony A7 IV', category: 'Cameras', description: 'Full-frame camera.', location: 'Colombo', dailyRate: 2500, photos: [], ratingAverage: 0, ratingCount: 0 }
const response = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) })

before(async () => {
  ;({ render, screen, waitFor, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  ;({ GuestBrowse } = await vite.ssrLoadModule('/src/features/products/pages/GuestBrowse.jsx'))
  globalThis.fetch = async (url) => response(url === '/api/public/products' ? { products: [camera] } : { reviews: [] })
})
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/') })
after(async () => { await vite?.close(); dom.window.close() })

test('clicking a listing opens a full-screen product page that Back closes', async () => {
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(GuestBrowse, { onSignIn: () => {} }))
  await user.click(await screen.findByRole('heading', { name: 'Sony A7 IV' }))
  const page = await screen.findByRole('region', { name: 'Sony A7 IV' })
  assert.ok(page.classList.contains('product-page'))
  assert.equal(new URLSearchParams(window.location.search).get('product'), camera._id)
  assert.equal(document.body.style.overflow, 'hidden')
  await user.click(screen.getByRole('button', { name: /Back to rentals/ }))
  await waitFor(() => assert.equal(screen.queryByRole('region', { name: 'Sony A7 IV' }), null))
  assert.equal(window.location.search, '')
  assert.equal(document.body.style.overflow, '')
})

test('a shared product link opens the product page once the catalog loads', async () => {
  window.history.replaceState({}, '', `/?product=${camera._id}`)
  render(React.createElement(GuestBrowse, { onSignIn: () => {} }))
  assert.ok(await screen.findByRole('region', { name: 'Sony A7 IV' }))
  assert.ok(screen.getByRole('button', { name: 'Sign in to rent this item' }))
})
