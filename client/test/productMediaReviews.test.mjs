import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Product media</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLDialogElement: dom.window.HTMLDialogElement, FileReader: dom.window.FileReader, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
let vite, Gallery, PhotoManager, Reviews, EditPhotos, EditProduct, render, screen, within, waitFor, cleanup, fireEvent, userEvent
const product = { _id: 'product-1', title: 'Sony camera', photos: ['/front.jpg', '/back.jpg', '/lens.jpg'] }
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
before(async () => {
  ;({ render, screen, within, waitFor, cleanup, fireEvent } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  Gallery = (await vite.ssrLoadModule('/src/features/products/components/ProductGallery.jsx')).default
  PhotoManager = (await vite.ssrLoadModule('/src/features/products/components/ProductPhotoManager.jsx')).default
  Reviews = (await vite.ssrLoadModule('/src/features/products/components/ProductReviews.jsx')).default
  EditPhotos = (await vite.ssrLoadModule('/src/features/shop-owner/components/EditListingPhotos.jsx')).default
  EditProduct = (await vite.ssrLoadModule('/src/features/admin/components/EditProductDialog.jsx')).default
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })
const tester = () => userEvent.setup({ document: dom.window.document })

test('gallery slides with thumbnails, arrows, keyboard and swipe; fullscreen supports zoom and Escape', async () => {
  const user = tester()
  render(React.createElement(Gallery, { product }))
  await user.click(screen.getByRole('button', { name: 'Show image 3' }))
  assert.equal(screen.getByRole('button', { name: 'Show image 3' }).getAttribute('aria-pressed'), 'true')
  await user.click(screen.getByRole('button', { name: 'Next image' }))
  assert.ok(screen.getByText('1 / 3'))
  await user.keyboard('{ArrowLeft}')
  assert.ok(screen.getByText('3 / 3'))
  const stage = document.querySelector('.product-gallery-stage')
  fireEvent.touchStart(stage, { touches: [{ clientX: 150, clientY: 30 }] })
  fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 50, clientY: 33 }] })
  assert.ok(screen.getByText('1 / 3'))
  // The synthetic click following a swipe should not open the lightbox.
  await user.click(screen.getByRole('button', { name: 'Open fullscreen image preview' }))
  assert.equal(screen.queryByRole('dialog'), null)
  await user.click(screen.getByRole('button', { name: 'Open fullscreen image preview' }))
  const dialog = screen.getByRole('dialog', { name: 'Sony camera image preview' })
  await user.click(within(dialog).getByRole('button', { name: 'Zoom in' }))
  assert.ok(within(dialog).getByRole('button', { name: 'Zoom out' }))
  await user.keyboard('{Escape}')
  assert.equal(screen.queryByRole('dialog'), null)
  assert.equal(document.activeElement, screen.getByRole('button', { name: 'Open fullscreen image preview' }))
})

test('photo editor appends selections, changes cover and preserves previous photos on invalid input', async () => {
  const user = tester()
  let current
  function Harness() {
    const [photos, setPhotos] = React.useState([])
    React.useEffect(() => { current = photos }, [photos])
    return React.createElement(PhotoManager, { photos, setPhotos })
  }
  render(React.createElement(Harness))
  const file = (name, type = 'image/png') => new dom.window.File(['test-image'], name, { type })
  const input = screen.getByLabelText('Add product photos')
  await user.upload(input, [file('front.png'), file('back.png')])
  await waitFor(() => assert.equal(current.length, 2))
  await user.upload(input, file('lens.png'))
  await waitFor(() => assert.equal(current.length, 3))
  await user.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }))
  assert.equal(current[0].name, 'back.png')
  fireEvent.change(input, { target: { files: [file('bad.svg', 'image/svg+xml')] } })
  assert.match(screen.getByRole('alert').textContent, /JPEG, PNG, or WebP/)
  assert.equal(current.length, 3)
  fireEvent.change(input, { target: { files: Array.from({ length: 4 }, (_, i) => file(`${i}.png`)) } })
  assert.match(screen.getByRole('alert').textContent, /up to 6/)
  assert.equal(current.length, 3)
  await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
  assert.equal(current.length, 2); assert.equal(current[0].name, 'front.png')
})

test('owner saves the ordered retained photo paths', async () => {
  const user = tester(); let sent, saved = false
  render(React.createElement(EditPhotos, { product, api: async (url, options) => { sent = { url, body: JSON.parse(options.body) } }, onClose: () => {}, onSaved: () => { saved = true } }))
  await user.click(screen.getByRole('button', { name: 'Move photo 3 earlier' }))
  await user.click(screen.getByRole('button', { name: 'Save photos' }))
  await waitFor(() => assert.equal(saved, true))
  assert.deepEqual(sent.body.photos, ['/front.jpg', '/lens.jpg', '/back.jpg'])
  assert.equal(sent.url, '/api/owner/products/product-1')
})

test('owner cannot save a listing with no photos', async () => {
  const user = tester()
  render(React.createElement(EditPhotos, { product: { ...product, photos: ['/front.jpg'] }, api: async () => assert.fail('An empty gallery must not be submitted'), onClose: () => {}, onSaved: () => {} }))
  await user.click(screen.getByRole('button', { name: 'Remove photo 1' }))
  assert.equal(screen.getByRole('button', { name: 'Save photos' }).disabled, true)
})

test('administrator edits include photo order in the save handler', async () => {
  const user = tester(); let sent
  render(React.createElement(EditProduct, { busy: false, editingProduct: { ...product, category: 'Cameras', dailyRate: 100, description: 'Camera kit' }, setEditingProduct: () => {}, editProduct: (event, photos) => { event.preventDefault(); sent = photos } }))
  await user.click(screen.getByRole('button', { name: 'Move photo 2 earlier' }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  assert.deepEqual(sent, ['/back.jpg', '/front.jpg', '/lens.jpg'])
})

test('review panel shows whole-product distribution, filters and paginates on the server', async () => {
  const user = tester(); const calls = []
  globalThis.fetch = async (url) => {
    calls.push(url)
    const params = new URL(url, 'http://localhost').searchParams
    return response({ summary: { ratingAverage: 4.5, ratingCount: 24, distribution: { 5: 12, 4: 12 } }, reviews: [{ _id: 'r1', rating: 5, comment: `Page ${params.get('page')}`, authorId: { username: 'Amal' }, createdAt: '2026-10-28T10:00:00.000Z' }], pagination: { page: Number(params.get('page')), total: 24, pages: 3 } })
  }
  render(React.createElement(Reviews, { product }))
  assert.ok(await screen.findByText('Amal'))
  assert.ok(screen.getByText('24 reviews'))
  assert.ok(screen.getByText('Verified rental', { exact: false }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  assert.ok(await screen.findByText('Page 2'))
  await user.click(screen.getByRole('button', { name: 'Filter by 5 stars' }))
  await waitFor(() => assert.match(calls.at(-1), /rating=5/))
  assert.match(calls.at(-1), /page=1/)
  await user.selectOptions(screen.getByLabelText('Sort reviews'), 'lowest')
  await waitFor(() => assert.match(calls.at(-1), /sort=lowest/))
  assert.ok(screen.getByText('24 reviews'))
})

test('review loading failure is visible and retry recovers without claiming there are no reviews', async () => {
  const user = tester(); let fails = true
  globalThis.fetch = async () => fails ? response({ message: 'Reviews temporarily unavailable' }, 503) : response({ reviews: [], summary: { ratingAverage: 0, ratingCount: 0, distribution: {} }, pagination: { page: 1, pages: 0 } })
  render(React.createElement(Reviews, { product }))
  assert.match((await screen.findByRole('alert')).textContent, /temporarily unavailable/)
  assert.equal(screen.queryByText(/No reviews yet. Be the first/), null)
  fails = false
  await user.click(screen.getByRole('button', { name: 'Retry reviews' }))
  assert.ok(await screen.findByText(/No reviews yet. Be the first/))
})
