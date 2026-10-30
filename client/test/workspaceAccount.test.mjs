import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Account</title></head><body></body></html>', { url: 'http://localhost/' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
  MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: (callback) => setTimeout(callback, 0), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false }
dom.window.HTMLElement.prototype.scrollTo = () => {}
let vite, Menu, render, screen, within, waitFor, cleanup, userEvent
before(async () => {
  ;({ render, screen, within, waitFor, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  Menu = (await vite.ssrLoadModule('/src/components/account/WorkspaceAccountMenu.jsx')).default
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('a shop owner edits their profile from the workspace account menu, without customer-only identity fields', async () => {
  const user = userEvent.setup({ document: dom.window.document })
  const shop = { username: 'Lens House', email: 'shop@example.com', phone: '0771234567', role: 'rental_shop', shopName: 'Lens House Colombo' }
  let sent, updated
  const api = async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return { message: 'Account details saved.', user: { ...shop, username: 'Lens House LK' } } }
  render(React.createElement(Menu, { user: shop, api, onLogout: () => {}, onAccountUpdate: (next) => { updated = next } }))
  await user.click(screen.getByRole('button', { name: 'Open profile menu' }))
  const menu = document.querySelector('.profile-dropdown')
  assert.ok(within(menu).getByText('Shop owner'))
  // The shop is shown by its shop name; the email stays in Contact information.
  assert.ok(within(menu).getByText('Lens House Colombo'))
  const menuText = document.querySelector('.workspace-account').textContent
  assert.ok(!menuText.includes('shop@example.com'))
  assert.equal(within(menu).queryByText('Lens House'), null)
  await user.click(screen.getByRole('button', { name: /Profile/ }))
  const dialog = document.getElementById('profile-settings')
  assert.ok(dialog.open)
  assert.ok(within(dialog).getByText('Shop owner'))
  assert.equal(within(dialog).getByLabelText(/Registered shop name/).value, 'Lens House Colombo')
  assert.equal(within(dialog).queryByText('NIC verification'), null)
  assert.equal(within(dialog).queryByRole('button', { name: /Verification/ }), null)
  await user.click(within(dialog).getByRole('button', { name: /Edit/ }))
  const name = within(dialog).getByLabelText(/Display name/)
  await user.clear(name); await user.type(name, 'Lens House LK')
  await user.click(within(dialog).getByRole('button', { name: /Save/ }))
  await user.type(within(dialog).getByLabelText(/password/i), 'Current-password-1')
  await user.click(within(dialog).getByRole('button', { name: /Confirm and save/ }))
  await waitFor(() => assert.equal(updated?.username, 'Lens House LK'))
  assert.equal(sent.url, '/api/account/profile')
  assert.deepEqual({ username: sent.body.username, password: sent.body.password, address: sent.body.address }, { username: 'Lens House LK', password: 'Current-password-1', address: '' })
})

test('the rider account menu signs out', async () => {
  const user = userEvent.setup({ document: dom.window.document })
  let signedOut = false
  render(React.createElement(Menu, { user: { username: 'Kasun', email: 'k@example.com', role: 'delivery_partner' }, api: async () => ({}), onLogout: () => { signedOut = true } }))
  await user.click(screen.getByRole('button', { name: 'Open profile menu' }))
  assert.ok(within(document.querySelector('.profile-dropdown')).getByText('Delivery partner'))
  await user.click(screen.getByRole('button', { name: 'Sign out' }))
  assert.equal(signedOut, true)
})
