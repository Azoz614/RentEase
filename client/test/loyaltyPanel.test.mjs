import { before, after, afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'
import React from 'react'

let vite, LoyaltyPanel, utils, render, screen, waitFor, cleanup, userEvent
const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Loyalty tests</title></head><body></body></html>', { url: 'http://localhost/?view=rewards' })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, getComputedStyle: dom.window.getComputedStyle, requestAnimationFrame: (callback) => setTimeout(() => callback(performance.now() + 5000), 0), cancelAnimationFrame: (id) => clearTimeout(id), IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true })
const loyalty = { points: 23, level: 2, pointsPerLevel: 10, pointsIntoLevel: 3, pointsToNextLevel: 7, rewardPercent: 2, rewardsEarned: 2, rewardsUsed: 1, rewardsAvailable: 1 }
const product = (id, title, bookingCount, extra = {}) => ({ _id: id, title, category: 'Cameras', dailyRate: 5000, photos: [], available: true, bookingCount, ratingCount: 0, ...extra })

before(async () => {
  ;({ render, screen, waitFor, cleanup } = await import('@testing-library/react'))
  userEvent = (await import('@testing-library/user-event')).default
  vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
  LoyaltyPanel = (await vite.ssrLoadModule('/src/features/loyalty/components/LoyaltyPanel.jsx')).default
  utils = await vite.ssrLoadModule('/src/features/loyalty/utils/loyalty.js')
})
afterEach(() => cleanup())
after(async () => { await vite?.close(); dom.window.close() })

test('reward amounts and trending order match the booking rules', () => {
  assert.equal(utils.loyaltyRewardAmount(5000), 100)
  assert.equal(utils.loyaltyRewardAmount(2575), 51.5)
  const ranked = utils.trendingProducts([product('a', 'Quiet', 0), product('b', 'Busy', 3), product('c', 'Rented', 9, { availabilityStatus: 'on_rental' })])
  assert.deepEqual(ranked.map((entry) => entry.title), ['Busy', 'Quiet'])
})

test('the rewards page shows levels, the wallet and redeems a reward on a trending item', async () => {
  const redeemed = []
  const api = async () => ({ activity: [{ type: 'earned', rentalId: 'r1', at: '2026-10-01T00:00:00Z', points: 5, title: 'Drone' }] })
  const user = userEvent.setup({ document: dom.window.document })
  render(React.createElement(LoyaltyPanel, {
    api, user: { _id: 'customer-1' }, loyalty, products: [product('p1', 'Sony A7 IV', 4), product('p2', 'Tripod', 1)], cart: [],
    days: 1, hours: 24, billingUnit: 'day', rewardProductId: '', redeemReward: (item) => { redeemed.push(item._id); return true },
    setRewardChoice: () => {}, openProductDetails: () => {}, onBrowse: () => {},
  }))
  assert.ok(screen.getByRole('img', { name: 'Level 2, 3 of 10 points to the next level' }))
  assert.ok(screen.getByText(/^7 points to Level 3 · Adventurer tier$/))
  assert.ok(screen.getByRole('listitem', { name: 'Level 1, reward used' }))
  assert.ok(screen.getByRole('listitem', { name: 'Level 2, reward ready' }))
  assert.ok(screen.getByRole('listitem', { name: 'Level 3, next level' }))
  await user.click(screen.getAllByRole('button', { name: /Use 2% · save/ })[0])
  assert.deepEqual(redeemed, ['p1'], 'the most booked item is first')
  assert.ok(screen.getByText('Sony A7 IV is in your request with 2% off.'))
  assert.ok(screen.getByText('Level 2 unlocked!'), 'a level not seen before is celebrated')
  await waitFor(() => assert.ok(screen.getByText('+5 points')))
})

test('without a reward the trending buttons say which level unlocks one', () => {
  render(React.createElement(LoyaltyPanel, {
    api: async () => ({ activity: [] }), user: { _id: 'customer-2' }, loyalty: { ...loyalty, points: 4, level: 0, pointsIntoLevel: 4, pointsToNextLevel: 6, rewardsEarned: 0, rewardsUsed: 0, rewardsAvailable: 0 },
    products: [product('p1', 'Sony A7 IV', 4)], cart: [], days: 1, hours: 24, billingUnit: 'day', rewardProductId: '',
    redeemReward: () => true, setRewardChoice: () => {}, openProductDetails: () => {}, onBrowse: () => {},
  }))
  assert.equal(screen.getByRole('button', { name: 'Unlock at Level 1' }).disabled, true)
  assert.equal(screen.queryByText(/more points to unlock your first/), null)
})
