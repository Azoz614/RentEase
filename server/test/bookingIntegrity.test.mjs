import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createApiRouter } from '../src/routes/api.routes.js'
import { createSession } from '../src/middleware/auth.mjs'
import { errorHandler } from '../src/middleware/error-handler.js'
import { User } from '../src/modules/users/user.model.mjs'
import { RentalRequest } from '../src/modules/rentals/rental.model.mjs'
import { Product } from '../src/modules/products/product.model.mjs'
import { Notification } from '../src/modules/notifications/notification.model.mjs'
import { VerificationRate } from '../src/modules/otp/verification-rate.model.mjs'
import { CommissionEntry } from '../src/modules/payments/commission.model.mjs'
import { AuditLog } from '../src/modules/admin/audit-log.model.mjs'
import { AccountOtp } from '../src/modules/otp/account-otp.model.mjs'
import { hashAccountOtp } from '../src/modules/otp/account-otp.service.mjs'

let mongo, app, passwordHash, admin, customer, shop
const password = 'Secure-existing-password'
const auth = (user, version = 0) => ({ Authorization: `Bearer ${createSession(user._id, version)}` })
const models = [User, RentalRequest, Product, Notification, VerificationRate, CommissionEntry, AuditLog, AccountOtp]
const item = (providerId, providerRole, title) => ({
  productId: new mongoose.Types.ObjectId(), providerId, providerRole, title,
  rentalAmount: 10000, depositAmount: 1000, decision: 'accepted',
})
const booking = (items, extra = {}) => RentalRequest.create({ customerId: customer._id, items,
  startDate: new Date(Date.now() + 72 * 3600000), endDate: new Date(Date.now() + 96 * 3600000),
  subtotal: 10000 * items.length, total: 10000 * items.length, deliveryMethod: 'pickup', status: 'confirmed', ...extra })
const pay = (rental) => request(app).post(`/api/requests/${rental._id}/payments`).set(auth(customer))
  .set('Idempotency-Key', `pay-${rental._id}`).send({})
const status = (rental, user, body) =>
  request(app).patch(`/api/provider/requests/${rental._id}/status`).set(auth(user)).send(body)

before(async () => {
  process.env.SESSION_SECRET = randomBytes(32).toString('hex'); process.env.OTP_SECRET = randomBytes(32).toString('hex')
  process.env.PAYMENT_PROVIDER = 'sandbox'; process.env.ADMIN_EMAIL = ''; process.env.SMTP_HOST = ''
  passwordHash = await bcrypt.hash(password, 10)
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('rentease_booking_integrity'))
  await Promise.all(models.map((model) => model.init()))
  app = express(); app.use(express.json()); app.use('/api', createApiRouter()); app.use(errorHandler)
}, { timeout: 180000 })
beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})))
  const create = (username, role) => User.create({ username, role, email: `${username}@gmail.com`, phone: '0771234567',
    password: passwordHash, ...(role === 'rental_shop' && { shopStatus: 'approved', shopName: username }) })
  admin = await create('admin', 'admin'); customer = await create('customer', 'user'); shop = await create('shop', 'rental_shop')
})
after(async () => { await mongoose.disconnect(); await mongo?.stop() })

test('a shop cannot take booking-wide actions on a booking shared with another provider', async () => {
  const shared = await booking([item(shop._id, 'rental_shop', 'Shop camera'), item(admin._id, 'admin', 'Org camera')])
  assert.equal((await pay(shared)).status, 200)
  for (const body of [{ status: 'cancelled', note: 'Shop wants out' }, { status: 'disputed', note: 'Claim' }])
    assert.equal((await status(shared, shop, body)).status, 403)
  await RentalRequest.updateOne({ _id: shared._id }, { status: 'active' })
  const fee = await request(app).post(`/api/provider/requests/${shared._id}/adjustments`).set(auth(shop))
    .send({ type: 'damage_fee', amount: 2000, note: 'Takes the whole deposit' })
  assert.equal(fee.status, 403)
  const stored = await RentalRequest.findById(shared._id)
  assert.equal(stored.status, 'active'); assert.equal(stored.payment.adjustments.length, 0)
  assert.equal((await status(shared, admin, { status: 'disputed', note: 'Admin review' })).status, 200)
})

test('a shop that supplies every item still manages its own booking', async () => {
  const own = await booking([item(shop._id, 'rental_shop', 'Shop camera')], { status: 'pending' })
  const cancelled = await status(own, shop, { status: 'cancelled', note: 'Out of stock' })
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body))
  assert.equal((await RentalRequest.findById(own._id)).status, 'cancelled')
})

test('completing through the status endpoint earns the pending shop commission', async () => {
  const own = await booking([item(shop._id, 'rental_shop', 'Shop camera')])
  assert.equal((await pay(own)).status, 200)
  assert.equal((await CommissionEntry.findOne({ kind: 'rental' })).status, 'pending')
  await RentalRequest.updateOne({ _id: own._id }, { status: 'returned', returnVerifiedAt: new Date() })
  const completed = await status(own, shop, { status: 'completed' })
  assert.equal(completed.status, 200, JSON.stringify(completed.body))
  const entry = await CommissionEntry.findOne({ kind: 'rental' })
  assert.equal(entry.status, 'earned'); assert.ok(entry.earnedAt)
})

test('a booking whose items were handed over can no longer be cancelled', async () => {
  const own = await booking([item(shop._id, 'rental_shop', 'Shop camera')])
  assert.equal((await pay(own)).status, 200)
  await RentalRequest.updateOne({ _id: own._id }, { status: 'disputed', pickupVerifiedAt: new Date(), returnVerifiedAt: new Date() })
  const cancelled = await status(own, admin, { status: 'cancelled', note: 'Refund after use' })
  assert.equal(cancelled.status, 409)
  const stored = await RentalRequest.findById(own._id)
  assert.equal(stored.status, 'disputed'); assert.equal(stored.payment.status, 'authorized')
  assert.equal((await CommissionEntry.findOne({ kind: 'rental' })).status, 'pending')
})

test('changing a password signs out other sessions and returns a working replacement', async () => {
  const oldSession = auth(customer)
  assert.equal((await request(app).get('/api/auth/me').set(oldSession)).status, 200)
  const wrong = await request(app).put('/api/account/password').set(oldSession)
    .send({ password: 'Not-the-password', newPassword: 'Brand-new-passphrase' })
  assert.ok(wrong.status >= 400 && wrong.status < 500, `wrong password should be a client error, got ${wrong.status}`)
  const changed = await request(app).put('/api/account/password').set(oldSession)
    .send({ password, newPassword: 'Brand-new-passphrase' })
  assert.equal(changed.status, 200, JSON.stringify(changed.body)); assert.ok(changed.body.token)
  assert.equal((await request(app).get('/api/auth/me').set(oldSession)).status, 401)
  assert.equal((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${changed.body.token}` })).status, 200)
})

test('parallel guesses cannot exceed the five-attempt limit on account codes', async () => {
  await AccountOtp.create({ userId: customer._id, purpose: 'password_change', targetEmail: '',
    otpHash: hashAccountOtp(customer._id, 'password_change', '123456'), expiresAt: new Date(Date.now() + 600000) })
  const guesses = await Promise.all(Array.from({ length: 12 }, (_, n) =>
    request(app).put('/api/account/password').set(auth(customer))
      .send({ verificationOtp: String(200000 + n), newPassword: 'Brand-new-passphrase' })))
  assert.ok(guesses.every((reply) => reply.status === 400 || reply.status === 429))
  assert.equal((await AccountOtp.findOne({ userId: customer._id })).attempts, 5)
  const correct = await request(app).put('/api/account/password').set(auth(customer))
    .send({ verificationOtp: '123456', newPassword: 'Brand-new-passphrase' })
  assert.equal(correct.status, 429, 'the right code is refused once attempts are spent')
})

test('a shop cannot republish a listing an administrator removed', async () => {
  const product = await Product.create({ title: 'Drone', category: 'Cameras', description: 'A drone for aerial photos.',
    dailyRate: 5000, photos: ['/uploads/products/00000000-0000-0000-0000-000000000000.jpg'],
    createdBy: shop._id, providerId: shop._id })
  const held = await request(app).patch(`/api/admin/products/${product._id}`).set(auth(admin))
    .set('X-Admin-Password', password).send({ active: false })
  assert.equal(held.status, 200, JSON.stringify(held.body))
  const republish = await request(app).patch(`/api/owner/products/${product._id}`).set(auth(shop)).send({ active: true })
  assert.equal(republish.status, 403)
  assert.equal((await Product.findById(product._id)).active, false)
  const restored = await request(app).patch(`/api/admin/products/${product._id}`).set(auth(admin))
    .set('X-Admin-Password', password).send({ active: true })
  assert.equal(restored.status, 200, JSON.stringify(restored.body))
  assert.equal((await request(app).patch(`/api/owner/products/${product._id}`).set(auth(shop)).send({ active: false })).status, 200)
  assert.equal((await request(app).patch(`/api/owner/products/${product._id}`).set(auth(shop)).send({ active: true })).status, 200)
})

test('admin changes need the admin password; only records without rental history can be deleted', async () => {
  const listing = (owner, title) => Product.create({ title, category: 'Cameras', description: 'A camera for testing.',
    dailyRate: 5000, photos: ['/uploads/products/00000000-0000-0000-0000-000000000000.jpg'], createdBy: owner._id, providerId: owner._id })
  const adminCall = (method, path, secret) => {
    const call = request(app)[method](`/api/admin${path}`).set(auth(admin))
    return secret === undefined ? call : call.set('X-Admin-Password', encodeURIComponent(secret))
  }
  const fresh = await listing(shop, 'Unbooked lens')
  assert.equal((await adminCall('get', '/products')).status, 200)
  const missing = await adminCall('delete', `/products/${fresh._id}`)
  assert.equal(missing.status, 400); assert.equal(missing.body.code, 'PASSWORD_REQUIRED')
  const wrong = await adminCall('delete', `/products/${fresh._id}`, 'Not-the-password')
  assert.equal(wrong.status, 403); assert.equal(wrong.body.code, 'PASSWORD_INCORRECT')
  assert.ok(await Product.exists({ _id: fresh._id }))
  assert.equal((await adminCall('delete', `/products/${fresh._id}`, password)).status, 200)
  assert.equal(await Product.exists({ _id: fresh._id }), null)

  const booked = await listing(shop, 'Booked camera')
  await booking([{ ...item(shop._id, 'rental_shop', 'Booked camera'), productId: booked._id }])
  assert.equal((await adminCall('delete', `/products/${booked._id}`, password)).status, 409)
  assert.equal((await adminCall('delete', `/users/${customer._id}`, password)).status, 409)
  assert.equal((await adminCall('delete', `/users/${shop._id}`, password)).status, 409)
  assert.equal((await adminCall('delete', `/users/${admin._id}`, password)).status, 400)

  const held = await adminCall('patch', `/users/${customer._id}`, password).send({ active: false })
  assert.equal(held.status, 200); assert.equal((await User.findById(customer._id)).active, false)

  const newShop = await User.create({ username: 'newshop', role: 'rental_shop', email: 'newshop@gmail.com', phone: '0771234567',
    password: passwordHash, shopStatus: 'approved', shopName: 'newshop' })
  const unbooked = await listing(newShop, 'Spare tripod')
  assert.equal((await adminCall('delete', `/users/${newShop._id}`, password)).status, 200)
  assert.equal(await User.exists({ _id: newShop._id }), null)
  assert.equal(await Product.exists({ _id: unbooked._id }), null)
})

test('bookings nobody acted on by the end of their period expire; paid, running or future ones do not', async () => {
  const { expireStaleBookings } = await import('../src/modules/rentals/cancellation.service.mjs')
  const past = { startDate: new Date(Date.now() - 48 * 3600000), endDate: new Date(Date.now() - 3600000) }
  const unanswered = await booking([{ ...item(shop._id, 'rental_shop', 'A'), decision: 'pending' }], { status: 'pending', ...past })
  const unpaid = await booking([item(shop._id, 'rental_shop', 'B')], past)
  const paid = await booking([item(shop._id, 'rental_shop', 'C')], past)
  await RentalRequest.updateOne({ _id: paid._id }, { 'payment.status': 'authorized' })
  const future = await booking([{ ...item(shop._id, 'rental_shop', 'D'), decision: 'pending' }], { status: 'pending' })
  // A same-day booking starts at midnight; it must stay open for the shop to answer.
  const today = new Date(new Date().setHours(0, 0, 0, 0))
  const sameDay = await booking([{ ...item(shop._id, 'rental_shop', 'E'), decision: 'pending' }],
    { status: 'pending', startDate: today, endDate: new Date(today.getTime() + 2 * 86400000) })
  assert.equal(await expireStaleBookings(), 2)
  const statuses = Object.fromEntries(await Promise.all([unanswered, unpaid, paid, future, sameDay].map(async (rental) =>
    [rental.items[0].title, (await RentalRequest.findById(rental._id)).status])))
  assert.deepEqual(statuses, { A: 'cancelled', B: 'cancelled', C: 'confirmed', D: 'pending', E: 'pending' })
  assert.match((await RentalRequest.findById(unpaid._id)).cancellationReason, /payment was not completed/)
  assert.ok(await Notification.exists({ userId: customer._id, requestId: unanswered._id }))
  assert.equal(await expireStaleBookings(), 0, 'a second sweep finds nothing left to expire')
})

test('approving some items and declining others continues with a repriced booking the customer can pay', async () => {
  const product = (title) => Product.create({ title, category: 'Cameras', description: `${title} for rent.`, dailyRate: 5000,
    photos: ['/uploads/products/00000000-0000-0000-0000-000000000000.jpg'], createdBy: shop._id, providerId: shop._id })
  const [camera, lens] = await Promise.all([product('Camera'), product('Lens')])
  const pending = (p, amount, deposit) => ({ productId: p._id, providerId: shop._id, providerRole: 'rental_shop', title: p.title,
    rentalAmount: amount, depositAmount: deposit, decision: 'pending' })
  // Approving needs a verified customer NIC, so the camera starts approved; the decline goes through the API.
  const rental = await booking([{ ...pending(camera, 8000, 2000), decision: 'accepted' }, pending(lens, 2000, 500)],
    { status: 'pending', subtotal: 10000, discountAmount: 1000, total: 9000, couponCode: 'TEN' })
  const decide = (p, decision, reason) => request(app).patch(`/api/provider/requests/${rental._id}/items/${p._id}`)
    .set(auth(shop)).send({ decision, reason })
  const declined = await decide(lens, 'rejected', 'Lens is being repaired')
  assert.equal(declined.status, 200, JSON.stringify(declined.body))
  const stored = await RentalRequest.findById(rental._id)
  assert.equal(stored.status, 'confirmed')
  assert.deepEqual(stored.items.map((i) => i.title), ['Camera'])
  assert.deepEqual(stored.declinedItems.map((i) => [i.title, i.decisionReason]), [['Lens', 'Lens is being repaired']])
  assert.equal(stored.subtotal, 8000); assert.equal(stored.discountAmount, 800); assert.equal(stored.total, 7200)
  const paid = await pay(stored)
  assert.equal(paid.status, 200, JSON.stringify(paid.body))
  assert.equal((await RentalRequest.findById(rental._id)).payment.depositHeld, 2000, 'only the approved item deposit is held')
})

test('customers rate ended rentals once and the shop sees the review under that product', async () => {
  const { RentalReview } = await import('../src/modules/products/rental-review.model.mjs')
  await RentalReview.deleteMany({})
  const camera = await Product.create({ title: 'Shop camera', category: 'Cameras', description: 'Camera', dailyRate: 1000,
    location: 'Colombo', photos: ['/uploads/products/camera.jpg'], createdBy: shop._id, providerId: shop._id })
  const rented = { ...item(shop._id, 'rental_shop', 'Shop camera'), productId: camera._id }
  const ended = await booking([rented], { status: 'completed', returnVerifiedAt: new Date() })
  const upcoming = await booking([{ ...rented }])
  const view = async (rental) => (await request(app).get(`/api/requests/${rental._id}`).set(auth(customer))).body.rental.items[0]
  assert.equal((await view(upcoming)).reviewable, false)
  assert.equal((await view(ended)).reviewable, true)
  const review = { requestId: ended._id, productId: camera._id, rating: 5, comment: 'Spotless camera.' }
  assert.equal((await request(app).post('/api/reviews').set(auth(customer)).send(review)).status, 201)
  assert.equal((await request(app).post('/api/reviews').set(auth(customer)).send(review)).status, 409)
  const rated = await view(ended)
  assert.equal(rated.reviewable, false); assert.equal(rated.review.rating, 5)
  assert.equal((await request(app).get('/api/owner/reviews').set(auth(customer))).status, 403)
  const owner = await request(app).get('/api/owner/reviews').set(auth(shop))
  assert.equal(owner.status, 200)
  assert.deepEqual(owner.body.summary, { ratingCount: 1, ratingAverage: 5 })
  const [product] = owner.body.products
  assert.equal(product.title, 'Shop camera'); assert.equal(product.ratingCount, 1)
  assert.equal(product.reviews[0].comment, 'Spotless camera.'); assert.equal(product.reviews[0].author, 'customer')
  assert.equal((await Product.findById(camera._id)).ratingCount, 1)
})

test('shop owners, riders and admins manage their own profile and password like customers', async () => {
  const rider = await User.create({ username: 'rider', role: 'delivery_partner', email: 'rider@gmail.com', phone: '0771234567', password: passwordHash })
  for (const account of [shop, rider, admin]) {
    const saved = await request(app).put('/api/account/profile').set(auth(account))
      .send({ username: `${account.username} renamed`, email: account.email, phone: '0779876543', address: '', password })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    assert.equal(saved.body.user.username, `${account.username} renamed`)
    const wrong = await request(app).put('/api/account/profile').set(auth(account))
      .send({ username: 'Someone else', email: account.email, phone: '0779876543', address: '', password: 'not-the-password' })
    assert.notEqual(wrong.status, 200)
    const changed = await request(app).put('/api/account/password').set(auth(account))
      .send({ password, newPassword: 'A-brand-new-passphrase' })
    assert.equal(changed.status, 200, JSON.stringify(changed.body)); assert.ok(changed.body.token)
  }
  assert.equal((await User.findById(shop._id)).shopName, 'shop')
})

test('disputing a booking releases a rider who accepted but has not collected the items', async () => {
  const { DeliveryTask } = await import('../src/modules/delivery/delivery-task.model.mjs')
  await DeliveryTask.deleteMany({})
  const rider = await User.create({ username: 'dispute-rider', role: 'delivery_partner', email: 'dispute-rider@gmail.com', phone: '0771234567', password: passwordHash })
  const own = await booking([{ ...item(shop._id, 'rental_shop', 'Shop camera'), assignedPartner: rider._id, deliveryStatus: 'heading_to_shop' }],
    { deliveryMethod: 'partner', deliveryWorkflowVersion: 2 })
  const spot = { type: 'Point', coordinates: [79.86, 6.92] }
  const task = await DeliveryTask.create({ rentalId: own._id, customerId: customer._id, providerId: shop._id, direction: 'delivery',
    productIds: own.items.map((i) => i.productId), titles: ['Shop camera'], pickup: { location: spot }, destination: { location: spot },
    status: 'heading_to_shop', assignedPartner: rider._id, search: { state: 'assigned' } })
  await User.updateOne({ _id: rider._id }, { activeDeliveryTask: task._id })
  const disputed = await status(own, admin, { status: 'disputed', note: 'Customer reported a problem' })
  assert.equal(disputed.status, 200, JSON.stringify(disputed.body))
  assert.equal((await User.findById(rider._id)).activeDeliveryTask, undefined)
  assert.equal((await DeliveryTask.findById(task._id)).status, 'cancelled')
})
