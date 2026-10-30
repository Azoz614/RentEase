import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { generateKeyPair, SignJWT } from 'jose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { createAuthRouter } from '../src/modules/auth/auth.routes.js'
import { verifyGoogleCredential } from '../src/modules/auth/google-auth.controller.mjs'
import { createApiRouter } from '../src/routes/api.routes.js'
import { createSession } from '../src/middleware/auth.mjs'
import { User } from '../src/modules/users/user.model.mjs'
import { RentalRequest } from '../src/modules/rentals/rental.model.mjs'
import { DeliveryTask } from '../src/modules/delivery/delivery-task.model.mjs'
import { Product } from '../src/modules/products/product.model.mjs'
import { Notification } from '../src/modules/notifications/notification.model.mjs'
import { VerificationRate } from '../src/modules/otp/verification-rate.model.mjs'
import { CommissionEntry } from '../src/modules/payments/commission.model.mjs'
import { AuditLog } from '../src/modules/admin/audit-log.model.mjs'
import { recordDeliveryCommission, commissionAmounts, rentalShares, earnRentalCommissions } from '../src/modules/payments/commission.service.mjs'

let mongo, app, keys, passwordHash, admin, customer, shop, rider, other
const password = 'Secure-existing-password'
const auth = (user) => ({ Authorization: `Bearer ${createSession(user._id)}` })
const models = [User, RentalRequest, DeliveryTask, Product, Notification, VerificationRate, CommissionEntry, AuditLog]
const post = (path, body, user) => request(app).post(`/api/${path}`).set(user ? auth(user) : {}).send(body)
async function googleToken(extra = {}, nonce) {
  nonce ||= (await request(app).get('/api/auth/google/config')).body.nonce
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ sub: 'google-person-123', email: 'new@gmail.com', email_verified: true, name: 'Google Customer', nonce,
    iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, iat: now, exp: now + 300, ...extra })
    .setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey)
}
async function booking(extra = {}) {
  return RentalRequest.create({ customerId: customer._id, items: [
    { productId: new mongoose.Types.ObjectId(), providerId: shop._id, providerRole: 'rental_shop', title: 'Shop camera', rentalAmount: 10000, depositAmount: 1000, decision: 'accepted' },
    { productId: new mongoose.Types.ObjectId(), providerId: admin._id, providerRole: 'admin', title: 'Organization camera', rentalAmount: 10000, decision: 'accepted' },
  ], startDate: new Date(Date.now() + 72 * 3600000), endDate: new Date(Date.now() + 96 * 3600000), subtotal: 20000, discountAmount: 1000,
    deliveryFee: 500, total: 19500, deliveryMethod: 'pickup', status: 'confirmed', ...extra })
}
const pay = (rental, key = 'payment-idempotency-key-123') => request(app).post(`/api/requests/${rental._id}/payments`).set(auth(customer)).set('Idempotency-Key', key).send({})

before(async () => {
  process.env.SESSION_SECRET = randomBytes(32).toString('hex'); process.env.OTP_SECRET = randomBytes(32).toString('hex')
  process.env.GOOGLE_CLIENT_ID = 'test-web-client.apps.googleusercontent.com'; process.env.PAYMENT_PROVIDER = 'sandbox'; process.env.ADMIN_EMAIL = ''; process.env.SMTP_HOST = ''
  keys = await generateKeyPair('RS256'); passwordHash = await bcrypt.hash(password, 10)
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('rentease_marketplace_improvements'))
  await Promise.all(models.map((model) => model.init()))
  app = express(); app.use(express.json())
  app.use('/api/auth', createAuthRouter({ verifyCredential: (token, audience) => verifyGoogleCredential(token, audience, keys.publicKey) }))
  app.use('/api', createApiRouter())
}, { timeout: 180000 })
beforeEach(async () => {
  await Promise.all(models.map((model) => model.deleteMany({})))
  const create = (username, role) => User.create({ username, role, email: `${username}@gmail.com`, phone: '0771234567', password: passwordHash, ...(role === 'rental_shop' && { shopStatus: 'approved', shopName: username }) })
  admin = await create('admin', 'admin'); customer = await create('customer', 'user'); shop = await create('shop', 'rental_shop'); rider = await create('rider', 'delivery_partner'); other = await create('other', 'user')
})
after(async () => { await mongoose.disconnect(); await mongo?.stop() })

test('Google creates one verified identity after collecting a real contact number, without privileged role escalation', async () => {
  const credential = await googleToken()
  const incomplete = await post('auth/google', { credential })
  assert.equal(incomplete.status, 409); assert.equal(incomplete.body.code, 'GOOGLE_PROFILE_REQUIRED')
  const created = await post('auth/google', { credential, phone: '0771234567', password, confirmPassword: password, role: 'admin' })
  assert.equal(created.status, 200, JSON.stringify(created.body)); assert.equal(created.body.user.role, 'user'); assert.ok(created.body.token)
  const stored = await User.findOne({ email: 'new@gmail.com' }).select('+googleSubject')
  assert.equal(stored.googleSubject, 'google-person-123'); assert.notEqual(stored.password, password)
  assert.ok(await bcrypt.compare(password, stored.password))
  assert.equal((await post('auth/login', { email: stored.email, password })).status, 200)
  assert.equal((await post('auth/google', { credential, phone: '0771234567' })).status, 401)
  const again = await post('auth/google', { credential: await googleToken() })
  assert.equal(again.status, 200); assert.equal(await User.countDocuments({ email: 'new@gmail.com' }), 1)
})

test('Google does not auto-link matching emails; password-authorized linking preserves shop role and approval', async () => {
  const credential = await googleToken({ email: shop.email })
  assert.equal((await post('auth/google', { credential })).body.code, 'GOOGLE_LINK_REQUIRED')
  assert.equal((await post('auth/google', { credential, password: 'incorrect' })).status, 401)
  const linked = await post('auth/google', { credential, password })
  assert.equal(linked.status, 200); assert.equal(linked.body.user.role, 'rental_shop'); assert.equal(linked.body.user.shopStatus, 'approved')
  assert.equal(await User.countDocuments({ email: shop.email }), 1)
  assert.equal((await post('auth/login', { email: shop.email, password })).status, 200)
})

test('Google rejects wrong signatures, audiences, issuers, unverified emails, expired credentials and unknown nonces', async () => {
  const now = Math.floor(Date.now() / 1000)
  const nonce = (await request(app).get('/api/auth/google/config')).body.nonce
  for (const payload of [{ aud: 'another-client' }, { iss: 'https://evil.example' }, { email_verified: false }, { exp: now - 60 }, { nonce: 'never-issued' }]) {
    const credential = await googleToken(payload, nonce)
    assert.equal((await post('auth/google', { credential, phone: '0771234567' })).status, 401, JSON.stringify(payload))
  }
  const differentKeys = await generateKeyPair('RS256')
  const forged = await new SignJWT({ sub: 'google-person-123', email: 'new@gmail.com', email_verified: true, nonce }).setProtectedHeader({ alg: 'RS256' }).setIssuer('https://accounts.google.com').setAudience(process.env.GOOGLE_CLIENT_ID).setIssuedAt().setExpirationTime('5m').sign(differentKeys.privateKey)
  assert.equal((await post('auth/google', { credential: forged, phone: '0771234567' })).status, 401)
  assert.equal(await User.countDocuments({ email: 'new@gmail.com' }), 0)
})

test('Google preserves suspension, shop approval, and third-party email ownership protections', async () => {
  await User.updateOne({ _id: shop._id }, { $set: { shopStatus: 'pending' } })
  assert.equal((await post('auth/google', { credential: await googleToken({ email: shop.email }), password })).status, 403)
  await User.updateOne({ _id: customer._id }, { $set: { active: false } })
  assert.equal((await post('auth/google', { credential: await googleToken({ email: customer.email }), password })).status, 403)
  assert.equal((await post('auth/google', { credential: await googleToken({ email: 'new@third-party.test' }), phone: '0771234567' })).status, 403)
})

test('notification read state persists, filters work and expired/private foreign notices are excluded', async () => {
  const [mine] = await Notification.create([
    { userId: customer._id, title: 'My booking', body: 'Private booking update', link: 'requests' },
    { userId: other._id, title: 'Someone else', body: 'Private OTP 987654', type: 'handover_otp', expiresAt: new Date(Date.now() + 300000) },
    { userId: customer._id, title: 'Expired code', body: 'Code 123456', expiresAt: new Date(0), type: 'handover_otp' },
  ])
  const inbox = await request(app).get('/api/inbox').set(auth(customer))
  assert.equal(inbox.body.notifications.length, 1); assert.equal(inbox.body.unreadCount, 1)
  assert.equal((await request(app).patch(`/api/notifications/${mine._id}`).set(auth(other)).send({ read: true })).status, 404)
  assert.equal((await request(app).patch(`/api/notifications/${mine._id}`).set(auth(customer)).send({ read: true })).status, 200)
  assert.ok((await Notification.findById(mine._id)).readAt)
  const freshSession = auth(await User.findById(customer._id))
  assert.equal((await request(app).get('/api/inbox?filter=unread').set(freshSession)).body.unreadCount, 0)
  assert.equal((await request(app).get('/api/inbox?filter=read').set(freshSession)).body.notifications.length, 1)
  assert.equal((await request(app).get('/api/inbox').set(auth(customer))).body.notifications[0].title, 'My booking')
})

test('notification unread count includes notices beyond the first page and mark-all is recipient-scoped', async () => {
  await Notification.insertMany(Array.from({ length: 105 }, (_, i) => ({ userId: customer._id, title: `Update ${i}`, body: 'Booking update' })))
  const foreign = await Notification.create({ userId: shop._id, title: 'Shop notice', body: 'Shop only' })
  const first = await request(app).get('/api/inbox?limit=5').set(auth(customer))
  assert.equal(first.body.unreadCount, 105); assert.equal(first.body.notifications.length, 5); assert.equal(first.body.hasMore, true)
  assert.equal((await request(app).patch('/api/inbox/read').set(auth(customer)).send({})).status, 200)
  assert.equal((await Notification.findById(foreign._id)).readAt, null)
  assert.equal((await request(app).get('/api/inbox?offset=100').set(auth(customer))).body.notifications.length, 5)
  assert.equal((await request(app).get('/api/inbox').set(auth(customer))).body.unreadCount, 0)
})

test('sandbox authorization records discounted shop-only 5% commission without adding customer charges', async () => {
  const rental = await booking()
  assert.equal((await pay(rental)).status, 200)
  const entry = await CommissionEntry.findOne().lean()
  assert.equal(await CommissionEntry.countDocuments(), 1)
  assert.equal(entry.grossMinor, 950000); assert.equal(entry.commissionMinor, 47500); assert.equal(entry.netMinor, 902500)
  assert.equal(entry.status, 'pending'); assert.equal(entry.paymentProvider, 'sandbox')
  assert.equal((await RentalRequest.findById(rental._id)).payment.rentalPaid, 19500)
  assert.equal((await pay(rental)).body.idempotent, true); assert.equal(await CommissionEntry.countDocuments(), 1)
})

test('concurrent payment events cannot duplicate commission deductions', async () => {
  const rental = await booking()
  const results = await Promise.all([pay(rental, 'payment-racing-key-one'), pay(rental, 'payment-racing-key-two')])
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
  assert.equal(await CommissionEntry.countDocuments(), 1)
})

test('failed gateway configuration leaves payments and commissions untouched', async () => {
  const rental = await booking()
  process.env.PAYMENT_PROVIDER = 'payhere'
  try { assert.equal((await pay(rental)).status, 503) }
  finally { process.env.PAYMENT_PROVIDER = 'sandbox' }
  assert.equal(await CommissionEntry.countDocuments(), 0)
  assert.equal((await RentalRequest.findById(rental._id)).payment.status, 'unpaid')
})

test('cancellation reverses ledger allocations atomically and deposit refunds do not reverse rental revenue', async () => {
  const rental = await booking(); await pay(rental)
  assert.equal((await post(`requests/${rental._id}/cancel`, {}, customer)).status, 200)
  let entry = await CommissionEntry.findOne()
  assert.equal(entry.status, 'reversed'); assert.equal(entry.refundedGrossMinor, entry.grossMinor)
  const next = await booking(); await pay(next, 'another-payment-key-123')
  await RentalRequest.updateOne({ _id: next._id }, { $set: { status: 'returned', returnVerifiedAt: new Date() } })
  const refund = await post(`provider/requests/${next._id}/deposit/refund`, {}, admin)
  assert.equal(refund.status, 200, JSON.stringify(refund.body))
  entry = await CommissionEntry.findOne({ rentalId: next._id })
  assert.equal(entry.refundedGrossMinor, 0); assert.equal(entry.status, 'pending')
})

test('delivery ledger allocates 1% once for each completed outbound and return trip and excludes cancelled/unpaid tasks', async () => {
  const rental = await booking({ commissionVersion: 1, status: 'active', payment: { status: 'authorized', provider: 'sandbox' } })
  const trip = { _id: new mongoose.Types.ObjectId(), rentalId: rental._id, assignedPartner: rider._id, direction: 'delivery', status: 'delivered', completedAt: new Date(), fee: 500 }
  await mongoose.connection.transaction(async (session) => { await recordDeliveryCommission(trip, rental, session); await recordDeliveryCommission(trip, rental, session) })
  await mongoose.connection.transaction((session) => recordDeliveryCommission({ ...trip, _id: new mongoose.Types.ObjectId(), direction: 'return', status: 'returned' }, rental, session))
  await mongoose.connection.transaction((session) => recordDeliveryCommission({ ...trip, _id: new mongoose.Types.ObjectId(), status: 'cancelled' }, rental, session))
  assert.equal(await CommissionEntry.countDocuments(), 2)
  const entry = await CommissionEntry.findOne()
  assert.equal(entry.grossMinor, 50000); assert.equal(entry.commissionMinor, 500); assert.equal(entry.netMinor, 49500)
  assert.equal(entry.status, 'earned')
})

test('financial reports use real ledgers, enforce recipient scope and never mark an allocation as transferred', async () => {
  const rental = await booking(); await pay(rental)
  await mongoose.connection.transaction((session) => earnRentalCommissions(rental, session))
  const report = await request(app).get('/api/commissions').set(auth(admin))
  assert.equal(report.status, 200); assert.equal(report.body.rental.earnedMinor, 47500); assert.equal(report.body.rental.settledMinor, 0)
  assert.equal(report.body.ledgerOnly, true)
  assert.equal((await request(app).get('/api/commissions').set(auth(customer))).status, 403)
  assert.equal((await request(app).get('/api/commissions').set(auth(shop))).body.entries.length, 1)
  assert.equal((await request(app).get('/api/commissions').set(auth(rider))).body.entries.length, 0)
  assert.equal((await request(app).get('/api/commissions?from=bad').set(auth(admin))).status, 400)
})

test('currency rounding and coupon allocation preserve exact minor-unit totals', () => {
  assert.deepEqual(commissionAmounts(1000000, 500), { grossMinor: 1000000, commissionMinor: 50000, netMinor: 950000, rateBasisPoints: 500 })
  assert.equal(commissionAmounts(1, 500).netMinor, 1)
  const shares = rentalShares({ items: [{ providerId: 'a', rentalAmount: 1 }, { providerId: 'b', rentalAmount: 1 }, { providerId: 'c', rentalAmount: 1 }], discountAmount: .01 })
  assert.equal(shares.reduce((sum, row) => sum + row.grossMinor, 0), 299)
})
