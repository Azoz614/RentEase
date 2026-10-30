import { before, beforeEach, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'
import { rentalMapMarkers, createRentalPin, createRentalPopup } from '../src/features/maps/utils/rentalMapMarkers.js'

const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Nearby rental map</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, HTMLLabelElement: dom.window.HTMLLabelElement, Element: dom.window.Element, SVGElement: dom.window.SVGElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get() { return 640 } })
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', { get() { return 475 } })
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { get() { return this.clientWidth } })
Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { get() { return this.clientHeight } })
dom.window.HTMLElement.prototype.getBoundingClientRect = function () { return { x: 0, y: 0, top: 0, left: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight } }
dom.window.scrollTo = () => {}
const shop = { _id: 'shop-1', shopName: 'Camera shop', shopAddress: 'Colombo pickup', shopLocation: { type: 'Point', coordinates: [79.86, 6.92] }, distanceMeters: 500 }
const products = [
  { _id: 'camera-1', title: 'Sony camera', category: 'Cameras', dailyRate: 2500, photos: ['/camera.jpg'], shop, available: true },
  { _id: 'camera-2', title: 'Canon camera', category: 'Cameras', dailyRate: 2000, photos: ['/canon.jpg'], shop, available: true },
  { _id: 'tripod-1', title: 'Tripod kit', category: 'Tools & equipment', dailyRate: 500, photos: [], shop: { ...shop, _id: 'shop-2', shopName: 'Equipment shop', shopLocation: { type: 'Point', coordinates: [79.88, 6.94] }, distanceMeters: 1500 }, available: true },
]
let vite, Nearby, GeoapifyMap, render, screen, within, waitFor, cleanup, act, userEvent
const originalKey = process.env.VITE_GEOAPIFY_API_KEY
before(async () => {
  process.env.VITE_GEOAPIFY_API_KEY = 'test-browser-key'
  ;({ render, screen, within, waitFor, cleanup, act } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (success) => success({ coords: { latitude: 6.92, longitude: 79.86 } }) } })
  globalThis.fetch = async () => new Response(JSON.stringify({ results: [{ lat: 6.92, lon: 79.86, formatted: 'Colombo search location' }] }), { headers: { 'content-type': 'application/json' } })
  vite = await createServer({ envDir: 'test/fixtures', server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  Nearby = (await vite.ssrLoadModule('/src/features/maps/components/NearbyRentals.jsx')).NearbyRentals
  GeoapifyMap = (await vite.ssrLoadModule('/src/features/maps/components/GeoapifyMap.jsx')).default
})
beforeEach(() => {
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (success) => success({ coords: { latitude: 6.92, longitude: 79.86 } }) } })
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
})
afterEach(() => cleanup())
after(async () => {
  await vite?.close(); dom.window.close()
  if (originalKey === undefined) delete process.env.VITE_GEOAPIFY_API_KEY
  else process.env.VITE_GEOAPIFY_API_KEY = originalKey
})
const user = () => userEvent.setup({ document: dom.window.document })
async function clickMarker(element) {
  // Leaflet copies enumerable MouseEvent fields for its synthetic preclick.
  // jsdom's pointer events need explicit coordinates for that copy.
  const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
  Object.defineProperties(event, { clientX: { value: 100, enumerable: true }, clientY: { value: 100, enumerable: true } })
  await act(async () => { element.dispatchEvent(event) })
}
async function chooseLocation(tester) {
  await tester.click(screen.getByRole('button', { name: 'Use my location' }))
}

test('product markers preserve real coordinates and group shared pickup locations', () => {
  const markers = rentalMapMarkers([...products, { ...products[0], _id: 'missing-location', shop: {} }])
  assert.equal(markers.length, 2)
  assert.deepEqual(markers[0].location, shop.shopLocation)
  assert.equal(markers[0].products.length, 2)
  assert.equal(markers[0].label, 'From LKR 2,000')
  assert.equal(markers[0].icon, 'camera')
  assert.equal(markers[1].icon, 'tools')
})

test('marker labels and product pickers treat listing content as text, with distinct product actions', () => {
  const marker = rentalMapMarkers(products)[0]
  marker.label = '<img src=x onerror=alert(1)>'
  marker.products[0].title = '<script>bad()</script>'
  const pin = createRentalPin(marker, true)
  assert.equal(pin.querySelector('img'), null)
  assert.match(pin.textContent, /<img src=x/)
  let selected
  const popup = createRentalPopup(marker, (id) => { selected = id })
  assert.equal(popup.querySelector('script'), null)
  popup.querySelectorAll('button')[1].click()
  assert.equal(selected, marker.products[1].id)
})

test('single-product map pins open that product, shared pins allow choosing the exact item', async () => {
  const tester = user(); let viewed
  render(React.createElement(Nearby, { api: async () => ({ products }), onView: (product) => { viewed = product }, startDate: '2026-11-02', endDate: '2026-11-05' }))
  await chooseLocation(tester)
  const single = await screen.findByTitle('View Tripod kit · LKR 500 per day')
  await clickMarker(single)
  assert.equal(viewed._id, 'tripod-1')
  assert.equal(viewed.providerId.shopName, 'Equipment shop')
  await clickMarker(await screen.findByTitle('2 rental items · from LKR 2,000 per day. Choose an item.'))
  await tester.click(await screen.findByRole('button', { name: 'View Canon camera · LKR 2,000 per day' }))
  assert.equal(viewed._id, 'camera-2')
  assert.ok(screen.getByText('3 rentals found'))
  const sidebar = screen.getByLabelText('Nearby rental products')
  assert.equal(within(sidebar).getAllByRole('article').length, 3)
})

test('map pins support keyboard activation and the results list opens products independently', async () => {
  const tester = user(); let viewed
  render(React.createElement(Nearby, { api: async () => ({ products }), onView: (product) => { viewed = product } }))
  await chooseLocation(tester)
  const marker = await screen.findByTitle('View Tripod kit · LKR 500 per day')
  marker.focus()
  await tester.keyboard(' ')
  assert.equal(viewed._id, 'tripod-1')
  const sidebar = screen.getByLabelText('Nearby rental products')
  await tester.click(within(sidebar).getByRole('button', { name: 'Sony camera' }))
  assert.equal(viewed._id, 'camera-1')
  await tester.click(within(sidebar).getByRole('button', { name: 'Show Canon camera on map' }))
  assert.equal(within(sidebar).getByRole('button', { name: 'Show Canon camera on map' }).getAttribute('aria-pressed'), 'true')
})

test('a changed radius discards stale results and a zero-result search remains usable', async () => {
  const tester = user(); let resolveSearch, next = 0
  render(React.createElement(Nearby, { api: () => ++next === 1 ? new Promise((resolve) => { resolveSearch = resolve }) : Promise.resolve({ products: [] }), onView: () => {} }))
  await chooseLocation(tester)
  await tester.selectOptions(screen.getByLabelText('Nearby radius'), '25')
  await screen.findByText('No available items in this area')
  await act(async () => { resolveSearch({ products }) })
  assert.equal(screen.queryByText('Sony camera'), null)
  assert.ok(await screen.findByText('No available items in this area'))
})

test('regular shop and draggable location markers keep their existing selection behavior', async () => {
  let selected
  render(React.createElement(GeoapifyMap, { markers: [{ id: 'shop-1', kind: 'shop', title: 'Existing pickup location', location: shop.shopLocation, draggable: true }], onSelect: (id) => { selected = id } }))
  await clickMarker(await screen.findByTitle('Existing pickup location'))
  assert.equal(selected, 'shop-1')
})

test('current location starts a search immediately, with no confirm or extra search step', async () => {
  const tester = user(), calls = []
  render(React.createElement(Nearby, { api: async (url) => { calls.push(url); return { products } }, onView: () => {}, startDate: '2026-11-02', endDate: '2026-11-05' }))
  assert.equal(calls.length, 0)
  assert.ok(screen.getByText('Where would you like to rent?'))
  await chooseLocation(tester)
  assert.ok(await screen.findByText('3 rentals found'))
  assert.equal(calls.length, 1)
  assert.match(calls[0], /startDate=2026-11-02/)
  assert.equal(screen.queryByRole('button', { name: 'Confirm location' }), null)
  assert.equal(screen.queryByRole('button', { name: 'Find nearest rentals' }), null)
  await tester.selectOptions(screen.getByLabelText('Nearby radius'), '25')
  await waitFor(() => assert.equal(calls.length, 2))
  assert.match(calls[1], /km=25/)
})

test('area search uses address suggestions and keeps advanced map controls optional', async () => {
  const tester = user(); let calls = 0
  render(React.createElement(Nearby, { api: async () => { calls++; return { products } }, onView: () => {} }))
  await tester.click(screen.getByRole('button', { name: 'Choose an area' }))
  await tester.type(screen.getByLabelText('Town, street or landmark'), 'Colombo')
  await tester.click(await screen.findByRole('button', { name: 'Colombo search location' }))
  assert.equal(calls, 0)
  assert.equal(screen.queryByRole('region', { name: 'Interactive location map' }), null)
  await tester.click(screen.getByRole('button', { name: 'Show rentals here' }))
  assert.ok(await screen.findByText('3 rentals found'))
  assert.equal(calls, 1)
  assert.ok(screen.getByText('Colombo search location'))
})

test('denied device location gives an area-search fallback without starting a rental search', async () => {
  const tester = user()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_success, failure) => failure({ code: 1 }) } })
  render(React.createElement(Nearby, { api: async () => assert.fail('No search without a chosen location'), onView: () => {} }))
  await chooseLocation(tester)
  assert.match((await screen.findByRole('alert')).textContent, /Location access is off/)
  assert.ok(screen.getByLabelText('Town, street or landmark'))
  assert.equal(screen.getByRole('button', { name: 'Use my location' }).disabled, false)
})

test('category and sort controls update both visible products and price pins', async () => {
  const tester = user()
  render(React.createElement(Nearby, { api: async () => ({ products }), onView: () => {} }))
  await chooseLocation(tester)
  await screen.findByText('3 rentals found')
  await tester.selectOptions(screen.getByLabelText('Item type'), 'Cameras')
  assert.ok(screen.getByText('2 rentals found'))
  assert.equal(screen.queryByTitle('View Tripod kit · LKR 500 per day'), null)
  await tester.selectOptions(screen.getByLabelText('Sort by'), 'price')
  const cards = within(screen.getByRole('region', { name: 'Nearby rental products' })).getAllByRole('article')
  assert.ok(within(cards[0]).getByRole('button', { name: 'Canon camera' }))
})

test('phone users switch between a readable list and map, and show-on-map switches views', async () => {
  const tester = user()
  window.matchMedia = (query) => ({ matches: query.includes('max-width: 850px'), addEventListener() {}, removeEventListener() {} })
  render(React.createElement(Nearby, { api: async () => ({ products }), onView: () => {} }))
  await chooseLocation(tester)
  await screen.findByText('3 rentals found')
  assert.equal(screen.queryByTitle('View Tripod kit · LKR 500 per day'), null)
  const list = screen.getByRole('region', { name: 'Nearby rental products' })
  await tester.click(within(list).getByRole('button', { name: 'Show Tripod kit on map' }))
  assert.ok(await screen.findByTitle('View Tripod kit · LKR 500 per day'))
  assert.equal(screen.getByRole('button', { name: 'Map', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(screen.queryByRole('region', { name: 'Nearby rental products' }), null)
  await tester.click(screen.getByRole('button', { name: 'List', exact: true }))
  assert.ok(screen.getByRole('region', { name: 'Nearby rental products' }))
})

test('failed searches can retry and empty searches can expand their radius in one action', async () => {
  const tester = user(); let calls = 0
  render(React.createElement(Nearby, { api: async () => {
    calls++
    if (calls === 1) throw new Error('Temporarily unavailable')
    return { products: calls === 2 ? [] : products }
  }, onView: () => {} }))
  await chooseLocation(tester)
  assert.match((await screen.findByRole('alert')).textContent, /Temporarily unavailable/)
  await tester.click(screen.getByRole('button', { name: 'Try again' }))
  assert.ok(await screen.findByText('No available items in this area'))
  await tester.click(screen.getByRole('button', { name: 'Search within 25 km' }))
  assert.ok(await screen.findByText('3 rentals found'))
  assert.equal(screen.getByLabelText('Nearby radius').value, '25')
})

test('nearby search and area controls have accessible names and no serious structural violations', async () => {
  const tester = user()
  const axe = (await import('axe-core')).default
  const view = render(React.createElement(Nearby, { api: async () => ({ products }), onView: () => {} }))
  await chooseLocation(tester)
  await screen.findByText('3 rentals found')
  let result = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(result.violations.filter((item) => ['serious', 'critical'].includes(item.impact)).map((item) => item.id), [])
  await tester.click(screen.getByRole('button', { name: 'Change area' }))
  assert.ok(screen.getByLabelText('Town, street or landmark'))
  result = await axe.run(view.container, { rules: { 'color-contrast': { enabled: false } } })
  assert.deepEqual(result.violations.filter((item) => ['serious', 'critical'].includes(item.impact)).map((item) => item.id), [])
})
