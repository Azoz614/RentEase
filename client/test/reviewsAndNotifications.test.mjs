import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Reviews</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
let vite, Notifications, Bell, WorkspaceNav, Reviews, ShopReviews, render, screen, within, waitFor, act, cleanup, userEvent
const user = () => userEvent.setup({ document: dom.window.document })
const id = (n) => String(n).padStart(24, 'a')
before(async () => {
  ;({ render, screen, within, waitFor, act, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  Notifications = (await vite.ssrLoadModule('/src/features/notifications/pages/NotificationCenter.jsx')).default
  Bell = (await vite.ssrLoadModule('/src/features/notifications/components/NotificationBell.jsx')).default
  WorkspaceNav = (await vite.ssrLoadModule('/src/components/ui/WorkspaceNav.jsx')).WorkspaceNav
  Reviews = (await vite.ssrLoadModule('/src/features/rentals/components/RentalReviewSection.jsx')).RentalReviewSection
  ShopReviews = (await vite.ssrLoadModule('/src/features/shop-owner/components/ShopReviews.jsx')).default
})
afterEach(() => { cleanup(); delete globalThis.IntersectionObserver })
after(async () => { await vite?.close(); dom.window.close() })

test('unread notifications that stay on screen are marked read in one request, but not ones the reader marked unread', async () => {
  const observers = []
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.nodes = []; observers.push(this) }
    observe(node) { this.nodes.push(node) }
    disconnect() { this.nodes = [] }
  }
  const rows = [1, 2].map((n) => ({ _id: id(n), title: `Update ${n}`, body: 'Body', readAt: null, createdAt: new Date().toISOString(), link: 'requests' }))
  const calls = []
  const api = async (url, options = {}) => {
    if (options.method) { calls.push({ url, body: JSON.parse(options.body) }); return {} }
    return { notifications: rows }
  }
  const seeAll = async () => {
    const observer = observers.at(-1)
    await act(async () => observer.callback(observer.nodes.map((target) => ({ target, isIntersecting: true, intersectionRatio: 1 }))))
  }
  render(React.createElement(Notifications, { api }))
  await screen.findByText('Update 1')
  await seeAll()
  await waitFor(() => assert.equal(calls.length, 1), { timeout: 4000 })
  assert.deepEqual(calls[0], { url: '/api/inbox/read', body: { ids: [id(1), id(2)] } })
  assert.equal(screen.queryByText('NEW'), null)
  await user().click(screen.getAllByRole('button', { name: 'Mark unread' })[0])
  assert.deepEqual(calls[1], { url: `/api/notifications/${id(1)}`, body: { read: false } })
  await seeAll()
  await act(() => new Promise((resolve) => setTimeout(resolve, 1500)))
  assert.equal(calls.length, 2)
  assert.equal(screen.getAllByText('NEW').length, 1)
})

test('clicking outside closes the notification dropdown and the notification details', async () => {
  globalThis.IntersectionObserver = class { observe() {} disconnect() {} }
  const rows = [{ _id: id(3), title: 'Booking approved', body: 'Your camera was approved.', readAt: new Date().toISOString(), createdAt: new Date().toISOString(), link: 'requests' }]
  const api = async (url, options = {}) => (options.method ? {} : { notifications: rows, unreadCount: 0 })
  const clicker = user()
  const outside = document.createElement('button')
  outside.textContent = 'Somewhere else'
  document.body.append(outside)
  try {
    render(React.createElement(Bell, { api, unreadCount: 0, onNavigate: () => {}, onHistory: () => {} }))
    const bell = screen.getByRole('button', { name: 'Notifications' })
    await clicker.click(bell)
    await screen.findByText('Booking approved')
    await clicker.click(outside)
    assert.equal(screen.queryByRole('region', { name: 'Recent notifications' }), null, 'dropdown closes')

    await clicker.click(bell)
    await clicker.click(await screen.findByRole('button', { name: 'Booking approved' }))
    assert.ok(screen.getByRole('dialog'))
    await clicker.click(outside)
    assert.equal(screen.queryByRole('region', { name: 'Recent notifications' }), null, 'dropdown with details closes')

    await clicker.click(bell)
    await screen.findByText('Booking approved')
    await clicker.keyboard('{Escape}')
    assert.equal(screen.queryByRole('region', { name: 'Recent notifications' }), null, 'Escape closes')
    assert.equal(document.activeElement, bell, 'focus returns to the bell')
    cleanup()

    // On the Notifications page an outside click lands on the dimmed backdrop around the details.
    render(React.createElement(Notifications, { api }))
    await clicker.click(await screen.findByRole('button', { name: 'Booking approved' }))
    assert.ok(screen.getByRole('dialog'))
    await clicker.click(document.querySelector('.nc-overlay'))
    assert.equal(screen.queryByRole('dialog'), null, 'notification page details close')
    cleanup()

    // The phone workspace menu, which holds Notifications, closes the same way.
    render(React.createElement(WorkspaceNav, { label: 'Owner workspace', active: 'inbox', onSelect: () => {},
      items: [{ id: 'overview', label: 'Overview' }, { id: 'inbox', label: 'Notifications' }] }))
    const menu = document.querySelector('.re-mobile-workspace-nav')
    await clicker.click(menu.querySelector('summary'))
    await waitFor(() => assert.equal(menu.open, true))
    await clicker.click(outside)
    await waitFor(() => assert.equal(menu.open, false, 'mobile menu closes'))
  } finally {
    outside.remove()
  }
})

test('a customer rates an ended rental item and sees the saved review', async () => {
  const tester = user(); let posted
  const rental = { _id: id(9), items: [{ productId: id(3), title: 'Canon EOS R6', reviewable: true, review: null }] }
  const api = async (_url, options) => { posted = JSON.parse(options.body); return { message: 'Saved' } }
  let saved = 0
  const view = render(React.createElement(Reviews, { api, rental, onSaved: () => { saved += 1 } }))
  assert.ok(screen.getByRole('heading', { name: 'How was your rental?' }))
  await tester.click(screen.getByRole('button', { name: 'Submit review' }))
  assert.ok(await screen.findByRole('alert'))
  await tester.click(screen.getByLabelText('4 stars'))
  await tester.type(screen.getByLabelText(/Tell other renters/), 'Clean and fully charged.')
  await tester.click(screen.getByRole('button', { name: 'Submit review' }))
  await waitFor(() => assert.equal(saved, 1))
  assert.deepEqual(posted, { requestId: id(9), productId: id(3), rating: 4, comment: 'Clean and fully charged.' })
  view.rerender(React.createElement(Reviews, { api, rental: { ...rental, items: [{ ...rental.items[0], reviewable: false, review: { rating: 4, comment: 'Clean and fully charged.', createdAt: new Date().toISOString() } }] }, onSaved: () => {} }))
  assert.ok(screen.getByRole('heading', { name: 'Your reviews' }))
  assert.ok(screen.getByLabelText('4 out of 5 stars'))
})

test('a shop owner sees reviews grouped by product', async () => {
  const tester = user()
  const api = async () => ({
    summary: { ratingAverage: 4.5, ratingCount: 2 },
    products: [
      { _id: id(1), title: 'Canon EOS R6', category: 'Cameras', ratingAverage: 4.5, ratingCount: 2, reviews: [
        { _id: id(11), rating: 5, comment: 'Perfect camera.', author: 'Nimal', createdAt: new Date().toISOString() },
        { _id: id(12), rating: 4, comment: '', author: 'Sara', createdAt: new Date().toISOString() }] },
      { _id: id(2), title: 'Camping tent', category: 'Camping', ratingAverage: 0, ratingCount: 0, reviews: [] },
    ],
  })
  render(React.createElement(ShopReviews, { api }))
  assert.ok(await screen.findByText('Perfect camera.'))
  assert.equal(screen.queryByText('Camping tent'), null)
  await tester.click(screen.getByRole('button', { name: 'All listings' }))
  const tent = screen.getByRole('button', { name: /Camping tent/ })
  await tester.click(tent)
  assert.ok(screen.getByText('This listing has not been reviewed yet.'))
  assert.equal(screen.queryByText('Perfect camera.'), null)
  assert.ok(within(tent).getByText('No reviews yet'))
})
