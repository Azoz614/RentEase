import { before, after, afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, PartnerAvailability, render, screen, fireEvent, act, cleanup
let requests, watchers, cleared, calls
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Rider availability</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document,
  HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
const fix = (overrides = {}) => ({ timestamp: Date.now(), coords: { latitude: 6.9271, longitude: 79.8612, accuracy: 40 }, ...overrides })
const setup = () => render(React.createElement(PartnerAvailability, {
  api: async (_path, options) => { calls.push(JSON.parse(options.body)); return {} }, onRefresh: () => {},
}))
const click = () => fireEvent.click(screen.getByRole('button', { name: 'Go online' }))
before(async () => {
  ;({ render, screen, fireEvent, act, cleanup } = await import('@testing-library/react'))
  vite = await createServer({ envDir: 'test/fixtures', server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  PartnerAvailability = (await vite.ssrLoadModule('/src/features/delivery-partner/components/PartnerAvailability.jsx')).default
})
beforeEach(() => {
  requests = []; watchers = []; cleared = []; calls = []
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition: (success, error, options) => requests.push({ success, error, options }),
    watchPosition: (success, error, options) => { watchers.push({ success, error, options }); return watchers.length },
    clearWatch: (id) => cleared.push(id),
  } })
})
afterEach(async () => { await act(async () => cleanup()); mock.timers.reset() })
after(async () => { await vite?.close(); dom.window.close() })

test('going online starts with standard device location and only publishes a valid actual position', async () => {
  setup(); click()
  assert.equal(requests[0].options.enableHighAccuracy, false)
  assert.equal(calls.length, 0)
  await act(async () => requests[0].success(fix()))
  assert.ok(screen.getByText('You are online'))
  assert.deepEqual(calls[0].location.coordinates, [79.8612, 6.9271])
  assert.equal(watchers.length, 1)
})

test('an initial location timeout retries with high accuracy rather than claiming permission was denied', async () => {
  setup(); click()
  await act(async () => requests[0].error({ code: 3 }))
  assert.equal(requests.length, 2)
  assert.equal(requests[1].options.enableHighAccuracy, true)
  assert.equal(screen.queryByRole('alert'), null)
  await act(async () => requests[1].success(fix()))
  assert.ok(screen.getByText('You are online'))
})

test('temporary watch failures keep the rider online while a fresh real position is available', async () => {
  setup(); click()
  await act(async () => requests[0].success(fix()))
  await act(async () => watchers[0].error({ code: 2 }))
  assert.ok(screen.getByText('You are online'))
  assert.match(screen.getByRole('status').textContent, /Retrying/)
  assert.equal(calls.some((c) => c.online === false), false)
  assert.equal(requests.length, 2)
})

test('permission denial stops availability and gives instructions; stale callbacks cannot turn it back on', async () => {
  setup(); click()
  await act(async () => requests[0].error({ code: 1 }))
  assert.match(screen.getByRole('alert').textContent, /Location access is blocked/)
  assert.ok(screen.getByRole('button', { name: 'Go online' }))
  await act(async () => requests[0].success(fix()))
  assert.equal(calls.some((c) => c.online === true), false)
})

test('insecure HTTP is rejected with HTTPS guidance before requesting device location', () => {
  Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
  setup(); click()
  assert.match(screen.getByRole('alert').textContent, /HTTPS/)
  assert.equal(requests.length, 0)
})

test('stale or inaccurate coordinates are never used to go online', async () => {
  setup(); click()
  await act(async () => requests[0].success(fix({ timestamp: Date.now() - 120000 })))
  assert.equal(requests[1].options.enableHighAccuracy, true)
  await act(async () => requests[1].success(fix({ coords: { latitude: 6.92, longitude: 79.86, accuracy: 20000 } })))
  assert.match(screen.getByRole('alert').textContent, /fresh location/)
  assert.equal(calls.some((c) => c.online === true), false)
})

test('stale location automatically takes the rider offline even if the browser stops sending callbacks', async () => {
  mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.now() })
  setup(); click()
  await act(async () => requests[0].success(fix()))
  await act(async () => mock.timers.tick(80000))
  mock.timers.reset()
  assert.ok(screen.getByRole('button', { name: 'Go online' }))
  assert.match(screen.getByRole('alert').textContent, /Location updates have stopped/)
  assert.equal(calls.at(-1).online, false)
  assert.deepEqual(cleared, [1])
})
