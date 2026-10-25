import { before, after, beforeEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { User } from '../src/modules/users/user.model.mjs'
import { Product } from '../src/modules/products/product.model.mjs'
import { RentalRequest } from '../src/modules/rentals/rental.model.mjs'
import { AuditLog } from '../src/modules/admin/audit-log.model.mjs'
import { VerificationRate } from '../src/modules/otp/verification-rate.model.mjs'
import { IdentityVerification } from '../src/modules/identity/identity.model.mjs'
import { createSession } from '../src/middleware/auth.mjs'
import { createRentalVerificationRouter } from '../src/modules/rentals/handover.routes.js'
import { createCustomerPickupRouter } from '../src/modules/rentals/customer-handover.routes.js'
import rentalRoutes from '../src/routes/marketplace.routes.js'
import productionApp from '../src/app.js'
import { sendHandoverOtp } from '../src/config/mailer.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

let mongo, app, admin, customer, rental, product, headers
let emails = [], failEmail = false
const base = (id = rental._id, type = 'pickup') => `/api/admin/rentals/${id}/verification/${type}`
const send = (id, type) => request(app).post(`${base(id, type)}/send`).set(headers).send({})
const verify = (challenge, code = emails.at(-1).code, type = 'pickup', id = rental._id) => request(app).post(`${base(id, type)}/verify`).set(headers).send({ challengeId: challenge.challengeId, code })
const wrongCode = (value) => `${value[0] === '9' ? '0' : '9'}${value.slice(1)}`
const customerHeaders = () => ({ Authorization: `Bearer ${createSession(customer._id)}` })
const pickupPath = (id = rental._id) => `/api/requests/${id}/pickup`
const customerSend = () => request(app).post(`${pickupPath()}/send`).set(customerHeaders()).send({})
const customerVerify = (challenge, code = emails.at(-1).code) => request(app).post(`${pickupPath()}/verify`).set(customerHeaders()).send({ challengeId: challenge.challengeId, code })
const confirmHandover = () => request(app).post(`/api/admin/rentals/${rental._id}/handover/confirm`).set(headers).send({})
const cancel = (body = {}) => request(app).post(`/api/requests/${rental._id}/cancel`).set(customerHeaders()).send(body)
const allowCancellation = () => RentalRequest.updateOne({ _id: rental._id }, { $set: { startDate: new Date(Date.now() + 72 * 3600000), endDate: new Date(Date.now() + 96 * 3600000) } })

before(async () => {
  process.env.RENTAL_OTP_SECRET = randomBytes(32).toString('hex')
  process.env.SESSION_SECRET = randomBytes(32).toString('hex')
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('rentease_verification_tests'))
  await Promise.all([User.init(), Product.init(), RentalRequest.init(), AuditLog.init(), VerificationRate.init(), IdentityVerification.init()])
  app = express()
  app.use(express.json())
  app.use('/api/admin', createRentalVerificationRouter({ sendEmail: async (email, code, type, rentalId) => {
    if (failEmail) throw new Error('Mail provider unavailable')
    emails.push({ email, code, type, rentalId })
  } }))
  app.use('/api/v1/admin', createRentalVerificationRouter({ sendEmail: async (email, code, type, rentalId) => { emails.push({ email, code, type, rentalId }) } }))
  app.use('/api', createCustomerPickupRouter({ sendEmail: async (email, code, type, rentalId) => { if (failEmail) throw new Error('Mail unavailable'); emails.push({ email, code, type, rentalId }) } }))
  app.use('/api/v1', createCustomerPickupRouter({ sendEmail: async (email, code, type, rentalId) => { emails.push({ email, code, type, rentalId }) } }))
  app.use('/api', rentalRoutes)
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.name }))
}, { timeout: 180_000 })

after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })

beforeEach(async () => {
  mock.restoreAll()
  await Promise.all([User.deleteMany({}), Product.deleteMany({}), RentalRequest.deleteMany({}), AuditLog.deleteMany({}), VerificationRate.deleteMany({}), IdentityVerification.deleteMany({})])
  emails = []; failEmail = false
  admin = await User.create({ username: 'Operations Admin', email: 'admin@example.test', phone: '0701234567', password: 'test-password-only', role: 'admin' })
  customer = await User.create({ username: 'Test Customer', email: 'customer@example.test', phone: '0701234568', password: 'test-password-only' })
  const addressId = new mongoose.Types.ObjectId()
  const address = { line1: '12 Test Road', city: 'Colombo', district: 'Colombo', province: 'Western', postalCode: '00100', country: 'Sri Lanka' }
  await User.updateOne({ _id: customer._id }, { $set: { addresses: [{ _id: addressId, ...address }], defaultAddressId: addressId, defaultAddress: '12 Test Road, Colombo', identityStatus: 'approved' } })
  await IdentityVerification.create({ userId: customer._id, nicDigest: `isolated-fixture-${customer._id}`, fullName: 'Test Customer', dateOfBirth: '2000-01-01', phone: customer.phone, email: customer.email, address, front: { filename: 'test-only-front', uploadedAt: new Date() }, back: { filename: 'test-only-back', uploadedAt: new Date() }, status: 'approved', consentAt: new Date(), revision: 1 })
  product = await Product.create({ title: 'Rental camera', category: 'Cameras', description: 'Test inventory', dailyRate: 2500, photos: ['/test-camera.jpg'], createdBy: admin._id, providerId: admin._id })
  rental = await RentalRequest.create({ customerId: customer._id, items: [{ productId: product._id, providerId: admin._id, title: product.title, decision: 'accepted', rentalAmount: 2500 }], startDate: new Date(), endDate: new Date(Date.now() + 86400000), deliveryMethod: 'pickup', subtotal: 2500, total: 2500, status: 'confirmed', payment: { status: 'authorized', rentalPaid: 2500 } })
  await Product.updateOne({ _id: product._id }, { $push: { rentalSlots: { requestId: rental._id, startDate: rental.startDate, endDate: rental.endDate, status: 'accepted' } } })
  headers = { Authorization: `Bearer ${createSession(admin._id)}` }
})

test('full app routes v1 login, public catalog, customer requests and account lookup correctly', async () => {
  for (const prefix of ['/api', '/api/v1']) {
    const login = await request(productionApp).post(`${prefix}/auth/login`).send({})
    assert.equal(login.status, 400, JSON.stringify(login.body))
    assert.equal(login.body.message, 'Email and password are required.')
    const catalog = await request(productionApp).get(`${prefix}/public/products`)
    assert.equal(catalog.status, 200, JSON.stringify(catalog.body))
    assert.equal(catalog.body.products.length, 1)
    assert.equal((await request(productionApp).get(`${prefix}/requests`)).status, 401)
    const owned = await request(productionApp).get(`${prefix}/requests`).set(customerHeaders())
    assert.equal(owned.status, 200)
    assert.equal(owned.body.requests[0]._id, String(rental._id))
    const account = await request(productionApp).get(`${prefix}/auth/me`).set(customerHeaders())
    assert.equal(account.status, 200)
    assert.equal(account.body.user.password, undefined)
    assert.equal(account.body.user._id, String(customer._id))
  }
})

test('actual booking, approval, sandbox payment, customer pickup and cancellation integrate end to end', async () => {
  await User.updateOne({ _id: customer._id }, { $set: { nic: '200012345678', defaultAddress: '12 Test Road, Colombo' } })
  const book = (offset) => request(app).post('/api/requests').set(customerHeaders()).send({ productIds: [String(product._id)], startDate: new Date(Date.now() + offset * 3600000).toISOString(), endDate: new Date(Date.now() + (offset + 24) * 3600000).toISOString(), deliveryMethod: 'pickup' })
  const created = await book(72)
  assert.equal(created.status, 201, JSON.stringify(created.body))
  rental = await RentalRequest.findById(created.body.request._id)
  const approved = await request(app).patch(`/api/provider/requests/${rental._id}/items/${product._id}`).set(headers).send({ decision: 'accepted' })
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  const paid = await request(app).post(`/api/requests/${rental._id}/payments`).set(customerHeaders()).set('Idempotency-Key', 'test-booking-integration-0001').send({})
  assert.equal(paid.status, 200, JSON.stringify(paid.body))
  assert.equal((await request(app).post(`/api/admin/rentals/${rental._id}/ready`).set(headers).send({})).status, 200)
  const listed = await request(app).get('/api/requests').set(customerHeaders())
  assert.ok(listed.body.requests.some((entry) => entry._id === String(rental._id)))
  const sent = await customerSend()
  assert.equal(sent.status, 200)
  assert.equal(emails.at(-1).email, customer.email)
  assert.equal((await customerVerify(sent.body)).body.rental.status, 'confirmed')
  assert.equal((await confirmHandover()).body.rental.status, 'active')
  const active = await request(app).get(`/api/requests/${rental._id}`).set(customerHeaders())
  assert.equal(active.body.rental.status, 'active')
  assert.equal((await book(144)).status, 409)
  const returnCode = await send(rental._id, 'return')
  assert.equal((await verify(returnCode.body, emails.at(-1).code, 'return')).status, 200)
  assert.equal((await request(app).post(`/api/admin/rentals/${rental._id}/return/confirm`).set(headers).send({ inspectionNote: 'All items received and inspected in good condition.' })).status, 200)
  const secondBooking = await book(144)
  assert.equal(secondBooking.status, 201)
  rental = await RentalRequest.findById(secondBooking.body.request._id)
  assert.equal((await cancel({ reason: 'Plans changed before approval' })).body.request.status, 'cancelled')
  assert.equal((await customerSend()).status, 409)
  assert.ok((await request(app).get('/api/requests').set(customerHeaders())).body.requests.some((entry) => entry._id === String(rental._id) && entry.status === 'cancelled'))
})

test('staff cancellation also removes pending codes and blocks later customer verification', async () => {
  const sent = await customerSend()
  const response = await request(app).patch(`/api/provider/requests/${rental._id}/status`).set(headers).send({ status: 'cancelled', note: 'Inventory withdrawn' })
  assert.equal(response.status, 200)
  assert.equal(response.body.request.cancellationReason, 'Inventory withdrawn')
  assert.equal((await customerVerify(sent.body)).status, 409)
  assert.equal((await RentalRequest.findById(rental._id).select('+handover.pickup')).handover?.pickup, undefined)
})

test('customer verifies an email without collecting items; only admin confirmation starts rental', async () => {
  const sent = await customerSend()
  assert.equal(sent.status, 200, JSON.stringify(sent.body))
  const listing = await request(app).get('/api/requests').set(customerHeaders())
  assert.equal(listing.body.requests[0].pickupVerification.status, 'pending')
  const adminListing = await request(app).get('/api/admin/rentals').set(headers)
  assert.equal(adminListing.body.rentals[0].pickupVerification.status, 'pending')
  assert.equal((await confirmHandover()).status, 409)
  const verified = await customerVerify(sent.body)
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  assert.equal(verified.body.rental.status, 'confirmed')
  assert.equal(verified.body.rental.pickupVerification.status, 'customer_verified')
  assert.equal(verified.body.rental.pickupVerifiedAt, null)
  assert.equal((await customerVerify(sent.body)).status, 409)
  assert.equal((await customerSend()).status, 409)
  const progress = await request(app).get(`/api/admin/rentals/${rental._id}`).set(headers)
  assert.equal(progress.body.rental.pickupVerification.status, 'customer_verified')
  assert.equal(JSON.stringify(progress.body).includes('otpHash'), false)
  const confirmed = await confirmHandover()
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body))
  assert.equal(confirmed.body.rental.status, 'active')
  assert.equal((await confirmHandover()).status, 409)
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup')
  assert.ok(stored.pickupCustomerVerifiedAt)
  assert.ok(stored.pickupVerifiedAt)
  assert.equal(String(stored.pickupVerifiedBy), String(admin._id))
  assert.equal(stored.handover.pickup.otpHash, undefined)
  assert.deepEqual(stored.statusHistory.map((event) => event.action), ['pickup.customer_verified', 'pickup.handover_confirmed'])
  const returned = await send(rental._id, 'return')
  assert.equal((await verify(returned.body, emails.at(-1).code, 'return')).status, 200)
  const details = await request(app).get(`/api/requests/${rental._id}`).set(customerHeaders())
  assert.equal(details.body.rental.status, 'returned')
})

test('customer pickup ownership, authentication, versioned routes and admin authorization are enforced', async () => {
  const other = await User.create({ username: 'Other customer', email: 'other@test.example', password: 'test-password-only', phone: '0701111111' })
  for (const suffix of ['', '/send', '/verify']) {
    const method = suffix ? 'post' : 'get'
    assert.equal((await request(app)[method](`${pickupPath()}${suffix}`).send({})).status, 401)
    assert.equal((await request(app)[method](`${pickupPath()}${suffix}`).set('Authorization', `Bearer ${createSession(other._id)}`).send({ code: '123456', challengeId: '00000000-0000-4000-8000-000000000000' })).status, 404)
  }
  assert.equal((await request(app).post(`/api/admin/rentals/${rental._id}/handover/confirm`).set(customerHeaders()).send({})).status, 403)
  const sent = await request(app).post(`/api/v1/requests/${rental._id}/pickup/send`).set(customerHeaders()).send({})
  assert.equal(sent.status, 200)
  const resume = await request(app).get(pickupPath()).set(customerHeaders())
  assert.equal(resume.body.challengeId, sent.body.challengeId)
  assert.ok(resume.body.maskedEmail)
  assert.equal(JSON.stringify(resume.body).includes(emails.at(-1).code), false)
})

test('customer OTP uses five attempts, expiry, shared cooldown and registered email binding', async () => {
  const sent = await customerSend()
  assert.equal((await send()).status, 429)
  const bad = wrongCode(emails.at(-1).code)
  await Promise.all(Array.from({ length: 7 }, () => customerVerify(sent.body, bad)))
  assert.equal((await customerVerify(sent.body)).status, 429)
  const resume = await request(app).get(pickupPath()).set(customerHeaders())
  assert.equal(resume.body.attemptsRemaining, 0)
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { 'handover.pickup.sentAt': new Date(Date.now() - 61000) } })
  const resent = await customerSend()
  assert.equal(resent.status, 200)
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { 'handover.pickup.expiresAt': new Date(Date.now() - 1) } })
  assert.equal((await customerVerify(resent.body)).status, 410)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'confirmed')
})

test('customer email failures never activate rental or expose an OTP', async () => {
  failEmail = true
  const response = await customerSend()
  assert.equal(response.status, 502)
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup +handover.pickup.otpHash')
  assert.equal(stored.handover.pickup.status, 'failed')
  assert.equal(stored.handover.pickup.otpHash, undefined)
  assert.equal(stored.status, 'confirmed')
})

test('cancellation commits reason, timestamp, history, release and OTP invalidation together', async () => {
  await allowCancellation()
  const sent = await customerSend()
  const response = await cancel({ reason: 'Travel plans changed' })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.equal(response.body.request.status, 'cancelled')
  assert.equal(response.body.request.cancellationReason, 'Travel plans changed')
  assert.ok(response.body.request.cancelledAt)
  assert.equal(response.body.request.cancellation.allowed, false)
  assert.equal(response.body.request.payment.status, 'refunded')
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup')
  assert.equal(stored.handover?.pickup, undefined)
  assert.equal(stored.statusHistory.at(-1).previousStatus, 'confirmed')
  assert.equal((await Product.findById(product._id)).rentalSlots.length, 0)
  assert.equal((await cancel()).status, 409)
  assert.equal((await customerSend()).status, 409)
  assert.equal((await customerVerify(sent.body)).status, 409)
  assert.equal((await confirmHandover()).status, 409)
  assert.equal((await send(rental._id, 'return')).status, 409)
  const list = await request(app).get('/api/requests').set(customerHeaders())
  assert.equal(list.body.requests[0].status, 'cancelled')
  const adminList = await request(app).get('/api/admin/rentals').set(headers)
  assert.equal(adminList.body.stats.onRental, 0)
  assert.equal(adminList.body.stats.awaitingPickup, 0)
})

test('cancellation respects cutoff and rejects foreign, active and malformed requests', async () => {
  assert.equal((await cancel()).status, 409)
  await allowCancellation()
  assert.equal((await cancel({ reason: 'x'.repeat(501) })).status, 400)
  assert.equal((await request(app).post(`/api/requests/${rental._id}/cancel`).set(headers).send({})).status, 404)
  assert.equal((await request(app).post('/api/requests/not-an-id/cancel').set(customerHeaders()).send({})).status, 400)
  const sent = await customerSend(); await customerVerify(sent.body); await confirmHandover()
  assert.equal((await cancel()).status, 409)
})

test('concurrent cancellation and confirmed handover allow exactly one terminal outcome', async () => {
  await allowCancellation()
  const sent = await customerSend(); await customerVerify(sent.body)
  const responses = await Promise.all([cancel(), confirmHandover(), confirmHandover(), cancel()])
  assert.equal(responses.filter((response) => response.status === 200).length, 1)
  assert.ok(responses.every((response) => [200, 409].includes(response.status)))
  const stored = await RentalRequest.findById(rental._id)
  assert.ok(['active', 'cancelled'].includes(stored.status))
  assert.equal(await AuditLog.countDocuments({ action: { $in: ['booking.cancelled', 'rental.pickup.handover_confirmed'] } }), 1)
  assert.equal((await Product.findById(product._id)).rentalSlots.length, stored.status === 'active' ? 1 : 0)
})

test('concurrent cancellation and OTP verification never resurrect a cancelled booking', async () => {
  await allowCancellation()
  const sent = await customerSend()
  const responses = await Promise.all([customerVerify(sent.body), cancel()])
  assert.equal(responses[1].status, 200, JSON.stringify(responses[1].body))
  assert.ok([200, 409].includes(responses[0].status))
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup')
  assert.equal(stored.status, 'cancelled')
  assert.equal(stored.handover?.pickup, undefined)
  assert.equal((await confirmHandover()).status, 409)
})

test('audit failure rolls back cancellation and physical handover confirmation', async () => {
  await allowCancellation()
  const sent = await customerSend(); await customerVerify(sent.body)
  mock.method(AuditLog, 'create', async () => { throw new Error('test rollback') })
  assert.equal((await cancel()).status, 500)
  assert.equal((await confirmHandover()).status, 500)
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup')
  assert.equal(stored.status, 'confirmed')
  assert.equal(stored.handover.pickup.status, 'customer_verified')
  assert.equal(stored.cancelledAt, undefined)
  assert.equal((await Product.findById(product._id)).rentalSlots.length, 1)
})

test('pickup sends a cryptographic six-digit email code without exposing it or changing status', async () => {
  const response = await send()
  assert.equal(response.status, 200)
  assert.match(emails[0].code, /^\d{6}$/)
  assert.equal(emails[0].email, customer.email)
  assert.equal(response.body.maskedEmail, 'c***@example.test')
  assert.equal(JSON.stringify(response.body).includes(emails[0].code), false)
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup +handover.pickup.otpHash').lean()
  assert.equal(stored.status, 'confirmed')
  assert.notEqual(stored.handover.pickup.otpHash, emails[0].code)
  assert.equal(stored.handover.pickup.otpHash.length, 64)
  assert.equal(new Date(stored.handover.pickup.expiresAt) - new Date(stored.handover.pickup.sentAt), 300000)
})

test('valid pickup atomically activates the rental and records verifier, timestamps, history, and audit', async () => {
  const sent = await send()
  const response = await verify(sent.body)
  assert.equal(response.status, 200, JSON.stringify(response.body))
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup').lean()
  assert.equal(stored.status, 'active')
  assert.ok(stored.pickupVerifiedAt)
  assert.equal(String(stored.pickupVerifiedBy), String(admin._id))
  assert.equal(stored.handover.pickup.status, 'verified')
  assert.equal(stored.handover.pickup.otpHash, undefined)
  assert.equal(stored.statusHistory[0].previousStatus, 'confirmed')
  assert.equal(stored.statusHistory[0].verificationId, sent.body.challengeId)
  assert.equal(await AuditLog.countDocuments({ action: 'rental.pickup.verified' }), 1)
  assert.equal((await Product.findById(product._id)).rentalSlots.length, 1)
})

test('invalid pickup code increments attempts and preserves rental status', async () => {
  const sent = await send()
  const response = await verify(sent.body, wrongCode(emails[0].code))
  assert.equal(response.status, 400)
  assert.equal(response.body.code, 'OTP_INCORRECT')
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup')
  assert.equal(stored.status, 'confirmed')
  assert.equal(stored.handover.pickup.attempts, 1)
  assert.equal(await AuditLog.countDocuments(), 0)
})

test('expired OTP is rejected without changing rental state', async () => {
  const sent = await send()
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { 'handover.pickup.expiresAt': new Date(Date.now() - 1000) } })
  const response = await verify(sent.body)
  assert.equal(response.status, 410)
  assert.equal(response.body.code, 'OTP_EXPIRED')
  assert.equal((await RentalRequest.findById(rental._id)).status, 'confirmed')
})

test('five incorrect attempts lock verification, including concurrent submissions', async () => {
  const sent = await send()
  const bad = wrongCode(emails[0].code)
  await Promise.all(Array.from({ length: 8 }, () => verify(sent.body, bad)))
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup')
  assert.equal(stored.handover.pickup.attempts, 5)
  assert.equal(stored.status, 'confirmed')
  assert.equal((await verify(sent.body)).status, 429)
})

test('resend cooldown is enforced and concurrent send requests create only one email', async () => {
  const responses = await Promise.all([send(), send(), send()])
  assert.equal(responses.filter((response) => response.status === 200).length, 1)
  assert.ok(responses.every((response) => [200, 409, 429].includes(response.status)))
  assert.equal(emails.length, 1)
  const cooldown = await send()
  assert.equal(cooldown.status, 429)
  assert.ok(Number(cooldown.headers['retry-after']) > 0)
})

test('resending invalidates the previous challenge and only the new challenge works', async () => {
  const first = await send()
  const firstCode = emails[0].code
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { 'handover.pickup.sentAt': new Date(Date.now() - 61000) } })
  const second = await send()
  assert.notEqual(first.body.challengeId, second.body.challengeId)
  assert.equal((await verify(first.body, firstCode)).status, 409)
  assert.equal((await verify(second.body)).status, 200)
})

test('OTP reuse cannot activate a rental twice', async () => {
  const sent = await send()
  assert.equal((await verify(sent.body)).status, 200)
  assert.equal((await verify(sent.body)).status, 409)
  assert.equal(await AuditLog.countDocuments({ action: 'rental.pickup.verified' }), 1)
})

test('return uses a separate OTP, records actual return, and releases only this booking slots', async () => {
  const pickup = await send()
  const pickupCode = emails[0].code
  assert.equal((await verify(pickup.body)).status, 200)
  const returned = await send(rental._id, 'return')
  assert.equal(returned.status, 200)
  assert.equal(emails.at(-1).type, 'return')
  assert.equal((await verify(pickup.body, pickupCode, 'return')).status, 409)
  const otherBooking = new mongoose.Types.ObjectId()
  await Product.updateOne({ _id: product._id }, { $push: { rentalSlots: { requestId: otherBooking, startDate: new Date(Date.now() + 90000000), endDate: new Date(Date.now() + 180000000), status: 'accepted' } } })
  const response = await verify(returned.body, emails.at(-1).code, 'return')
  assert.equal(response.status, 200, JSON.stringify(response.body))
  const stored = await RentalRequest.findById(rental._id)
  assert.equal(stored.status, 'returned')
  assert.ok(stored.returnVerifiedAt)
  assert.equal(String(stored.returnVerifiedBy), String(admin._id))
  const slots = (await Product.findById(product._id)).rentalSlots
  assert.equal(slots.length, 1)
  assert.equal(String(slots[0].requestId), String(otherBooking))
  assert.equal((await send()).status, 409)
})

test('invalid return OTP keeps rental active and inventory reserved', async () => {
  const pickup = await send(); await verify(pickup.body)
  const returned = await send(rental._id, 'return')
  const response = await verify(returned.body, wrongCode(emails.at(-1).code), 'return')
  assert.equal(response.status, 400)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'active')
  assert.equal((await Product.findById(product._id)).rentalSlots.length, 1)
})

test('codes are bound to the rental and cannot be used on another rental', async () => {
  const first = await send()
  const second = await RentalRequest.create({ ...rental.toObject(), _id: new mongoose.Types.ObjectId() })
  assert.equal((await verify(first.body, emails[0].code, 'pickup', second._id)).status, 409)
  assert.equal((await RentalRequest.findById(second._id)).status, 'confirmed')
})

test('unauthenticated customers and rental shops cannot initiate, verify, or read admin history', async () => {
  assert.equal((await request(app).post(`${base()}/send`).send({})).status, 401)
  const customerHeaders = { Authorization: `Bearer ${createSession(customer._id)}` }
  for (const endpoint of [`${base()}/send`, `${base()}/verify`]) assert.equal((await request(app).post(endpoint).set(customerHeaders).send({})).status, 403)
  assert.equal((await request(app).get(`/api/admin/rentals/${rental._id}/history`).set(customerHeaders)).status, 403)
  await User.updateOne({ _id: customer._id }, { $set: { role: 'rental_shop', shopStatus: 'approved' } })
  assert.equal((await request(app).post(`${base()}/send`).set(customerHeaders).send({})).status, 403)
})

test('unpaid, cancelled, returned, unaccepted, and unverified historical rentals are ineligible', async () => {
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { 'payment.status': 'unpaid' } })
  assert.equal((await send()).status, 409)
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { 'payment.status': 'authorized', 'items.0.decision': 'pending' } })
  assert.equal((await send()).status, 409)
  for (const status of ['cancelled', 'returned', 'completed', 'active']) {
    await RentalRequest.updateOne({ _id: rental._id }, { $set: { status } })
    assert.equal((await send()).status, 409)
  }
  assert.equal((await send(rental._id, 'return')).body.code, 'PICKUP_NOT_VERIFIED')
})

test('alternative provider status endpoints cannot bypass either verification', async () => {
  for (const status of ['active', 'returned', 'completed']) {
    const response = await request(app).patch(`/api/provider/requests/${rental._id}/status`).set(headers).send({ status })
    assert.equal(response.status, 409)
  }
  assert.equal((await RentalRequest.findById(rental._id)).status, 'confirmed')
})

test('delivery endpoints cannot claim pickup or return before verification', async () => {
  await User.updateOne({ _id: customer._id }, { $set: { role: 'delivery_partner' } })
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { 'items.0.assignedPartner': customer._id, 'items.0.deliveryStatus': 'on_the_way' } })
  const driverHeaders = { Authorization: `Bearer ${createSession(customer._id)}` }
  for (const status of ['delivered', 'returned']) assert.equal((await request(app).patch(`/api/delivery/assignments/${rental._id}/items/${product._id}/status`).set(driverHeaders).send({ status })).status, 409)
})

test('concurrent verification attempts commit exactly one handover and audit event', async () => {
  const sent = await send()
  const responses = await Promise.all([verify(sent.body), verify(sent.body), verify(sent.body)])
  assert.equal(responses.filter((response) => response.status === 200).length, 1)
  const stored = await RentalRequest.findById(rental._id)
  assert.equal(stored.status, 'active')
  assert.equal(stored.statusHistory.length, 1)
  assert.equal(await AuditLog.countDocuments(), 1)
})

test('audit failure rolls back OTP consumption, rental status, and returned inventory', async () => {
  const pickup = await send(); await verify(pickup.body)
  const returned = await send(rental._id, 'return')
  const original = AuditLog.create
  mock.method(AuditLog, 'create', async () => { throw new Error('Injected transactional failure') })
  const failed = await verify(returned.body, emails.at(-1).code, 'return')
  assert.equal(failed.status, 500)
  const stored = await RentalRequest.findById(rental._id).select('+handover.return')
  assert.equal(stored.status, 'active')
  assert.equal(stored.returnVerifiedAt, undefined)
  assert.equal(stored.handover.return.status, 'sent')
  assert.equal((await Product.findById(product._id)).rentalSlots.length, 1)
  mock.restoreAll()
  assert.equal(AuditLog.create, original)
  assert.equal((await verify(returned.body, emails.at(-1).code, 'return')).status, 200)
})

test('email delivery failure invalidates the challenge and never updates rental status', async () => {
  failEmail = true
  const response = await send()
  assert.equal(response.status, 502)
  assert.equal(response.body.code, 'EMAIL_FAILED')
  const stored = await RentalRequest.findById(rental._id).select('+handover.pickup +handover.pickup.otpHash')
  assert.equal(stored.status, 'confirmed')
  assert.equal(stored.handover.pickup.status, 'failed')
  assert.equal(stored.handover.pickup.otpHash, undefined)
  assert.equal((await send()).status, 429)
})

test('generation rate limits persist in MongoDB', async () => {
  const bucket = Math.floor(Date.now() / 900000)
  await VerificationRate.create({ _id: `${admin._id}:send:${bucket}`, count: 20, expiresAt: new Date(Date.now() + 1800000) })
  assert.equal((await send()).status, 429)
  assert.equal(emails.length, 0)
})

test('customer email changes invalidate an existing challenge', async () => {
  const sent = await send()
  await User.updateOne({ _id: customer._id }, { $set: { email: 'new-address@example.test' } })
  const response = await verify(sent.body)
  assert.equal(response.status, 409)
  assert.equal(response.body.code, 'CUSTOMER_CHANGED')
})

test('list, details, history, and customer endpoints never expose OTP hashes', async () => {
  const sent = await send()
  for (const endpoint of ['/api/admin/rentals', `/api/admin/rentals/${rental._id}`, `/api/admin/rentals/${rental._id}/history`]) {
    const result = await request(app).get(endpoint).set(headers)
    assert.equal(result.status, 200)
    assert.equal(JSON.stringify(result.body).includes('otpHash'), false)
    assert.equal(JSON.stringify(result.body).includes('handover'), false)
    assert.equal(JSON.stringify(result.body).includes(emails[0].code), false)
  }
  const result = await request(app).get('/api/requests').set({ Authorization: `Bearer ${createSession(customer._id)}` })
  assert.equal(result.status, 200)
  assert.equal(JSON.stringify(result.body).includes('otpHash'), false)
  assert.equal(JSON.stringify(result.body).includes('challengeId'), false)
  await verify(sent.body)
  const details = await request(app).get(`/api/admin/rentals/${rental._id}`).set(headers)
  assert.equal(details.body.rental.lifecycleStatus, 'ON_RENTAL')
  assert.equal(details.body.rental.pickupVerifiedBy.username, admin.username)
})

test('strict validation rejects malformed IDs, action types, and codes', async () => {
  assert.equal((await send('not-an-id')).status, 400)
  assert.equal((await send(rental._id, 'other')).status, 400)
  assert.equal((await verify({ challengeId: 'invalid' }, '123')).status, 400)
  assert.equal((await send(new mongoose.Types.ObjectId())).status, 404)
})

test('actual email service fails explicitly when SMTP is not configured', async () => {
  const saved = process.env.SMTP_HOST
  delete process.env.SMTP_HOST
  await assert.rejects(() => sendHandoverOtp('customer@example.test', '123456', 'pickup', String(rental._id)), /not configured/)
  if (saved) process.env.SMTP_HOST = saved
})

test('a stale legacy document save cannot overwrite an OTP-verified status', async () => {
  const stale = await RentalRequest.findById(rental._id)
  const sent = await send()
  assert.equal((await verify(sent.body)).status, 200)
  stale.status = 'cancelled'
  await assert.rejects(() => stale.save(), { name: 'VersionError' })
  assert.equal((await RentalRequest.findById(rental._id)).status, 'active')
})

test('versioned admin endpoints, customer/item search, and status filters use existing records', async () => {
  const list = await request(app).get('/api/v1/admin/rentals?q=Test%20Customer&status=confirmed').set(headers)
  assert.equal(list.status, 200)
  assert.equal(list.body.total, 1)
  assert.equal(list.body.rentals[0].lifecycleStatus, 'BOOKED')
  const items = await request(app).get('/api/admin/rentals?q=Rental%20camera').set(headers)
  assert.equal(items.body.total, 1)
  const empty = await request(app).get('/api/admin/rentals?status=returned').set(headers)
  assert.equal(empty.body.total, 0)
  assert.equal(empty.body.stats.awaitingPickup, 1)
})

test('cancelled products become available and can be requested for the same dates again', async () => {
  await allowCancellation()
  rental = await RentalRequest.findById(rental._id)
  await Product.updateOne({ _id: product._id }, { $set: { rentalSlots: [{ requestId: rental._id, startDate: rental.startDate, endDate: rental.endDate, status: 'accepted' }] } })
  await User.updateOne({ _id: customer._id }, { $set: { nic: '200012345678', defaultAddress: '12 Test Road, Colombo' } })
  const query = `/api/products?startDate=${rental.startDate.toISOString()}&endDate=${rental.endDate.toISOString()}`
  assert.equal((await request(app).get(query).set(customerHeaders())).body.products[0].available, false)
  assert.equal((await cancel()).status, 200)
  const available = await request(app).get(query).set(customerHeaders())
  assert.equal(available.body.products[0].available, true)
  const rebooked = await request(app).post('/api/requests').set(customerHeaders()).send({ productIds: [String(product._id)], startDate: rental.startDate.toISOString(), endDate: rental.endDate.toISOString(), deliveryMethod: 'pickup' })
  assert.equal(rebooked.status, 201, JSON.stringify(rebooked.body))
})

test('legacy cancelled slots do not block the catalog or atomic request reservation', async () => {
  await allowCancellation()
  rental = await RentalRequest.findById(rental._id)
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { status: 'cancelled' } })
  await Product.updateOne({ _id: product._id }, { $set: { rentalSlots: [{ requestId: rental._id, startDate: rental.startDate, endDate: rental.endDate, status: 'accepted' }] } })
  await User.updateOne({ _id: customer._id }, { $set: { nic: '200012345678', defaultAddress: '12 Test Road, Colombo' } })
  const available = await request(app).get(`/api/products?startDate=${rental.startDate.toISOString()}&endDate=${rental.endDate.toISOString()}`).set(customerHeaders())
  assert.equal(available.body.products[0].available, true)
  const body = { productIds: [String(product._id)], startDate: rental.startDate.toISOString(), endDate: rental.endDate.toISOString(), deliveryMethod: 'pickup' }
  const responses = await Promise.all([request(app).post('/api/requests').set(customerHeaders()).send(body), request(app).post('/api/requests').set(customerHeaders()).send(body)])
  assert.equal(responses.filter((response) => response.status === 201).length, 1)
  assert.equal(responses.filter((response) => response.status === 409).length, 1)
  assert.equal(await RentalRequest.countDocuments({ status: 'pending' }), 1)
})

test('currently on-rental inventory cannot be requested even past its planned end or for future dates', async () => {
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { status: 'active', pickupVerifiedAt: new Date(Date.now() - 96 * 3600000), startDate: new Date(Date.now() - 96 * 3600000), endDate: new Date(Date.now() - 72 * 3600000) } })
  await User.updateOne({ _id: customer._id }, { $set: { nic: '200012345678', defaultAddress: '12 Test Road, Colombo' } })
  const startDate = new Date(Date.now() + 72 * 3600000).toISOString(), endDate = new Date(Date.now() + 96 * 3600000).toISOString()
  const catalog = await request(app).get(`/api/products?startDate=${startDate}&endDate=${endDate}`).set(customerHeaders())
  assert.equal(catalog.body.products[0].available, false)
  assert.equal(catalog.body.products[0].availabilityStatus, 'on_rental')
  const rejected = await request(app).post('/api/requests').set(customerHeaders()).send({ productIds: [String(product._id)], startDate, endDate, deliveryMethod: 'pickup' })
  assert.equal(rejected.status, 409)
  assert.match(rejected.body.message, /currently on rental/)
  assert.equal(await RentalRequest.countDocuments(), 1)
})

test('an overlapping live booking blocks requests even if its legacy inventory slot is missing', async () => {
  await allowCancellation()
  rental = await RentalRequest.findById(rental._id)
  await Product.updateOne({ _id: product._id }, { $set: { rentalSlots: [] } })
  await User.updateOne({ _id: customer._id }, { $set: { nic: '200012345678', defaultAddress: '12 Test Road, Colombo' } })
  const query = `/api/products?startDate=${rental.startDate.toISOString()}&endDate=${rental.endDate.toISOString()}`
  assert.equal((await request(app).get(query).set(customerHeaders())).body.products[0].availabilityStatus, 'booked')
  const rejected = await request(app).post('/api/requests').set(customerHeaders()).send({ productIds: [String(product._id)], startDate: rental.startDate.toISOString(), endDate: rental.endDate.toISOString(), deliveryMethod: 'pickup' })
  assert.equal(rejected.status, 409)
})

test('existing date availability remains blocked through pickup and opens after verified return', async () => {
  const catalogPath = `/api/products?startDate=${encodeURIComponent(rental.startDate.toISOString())}&endDate=${encodeURIComponent(rental.endDate.toISOString())}`
  const customerHeaders = { Authorization: `Bearer ${createSession(customer._id)}` }
  const beforePickup = await request(app).get(catalogPath).set(customerHeaders)
  assert.equal(beforePickup.status, 200)
  assert.equal(beforePickup.body.products[0].available, false)
  const pickup = await send(); await verify(pickup.body)
  assert.equal((await request(app).get(catalogPath).set(customerHeaders)).body.products[0].available, false)
  const returned = await send(rental._id, 'return'); await verify(returned.body, emails.at(-1).code, 'return')
  assert.equal((await request(app).get(catalogPath).set(customerHeaders)).body.products[0].available, true)
})

test('standalone database topology fails closed before sending a code or changing a rental', async () => {
  mock.method(mongoose.connection.db, 'admin', () => ({ command: async () => ({ isWritablePrimary: true }) }))
  const result = await send()
  assert.equal(result.status, 503)
  assert.equal(result.body.code, 'TRANSACTIONS_REQUIRED')
  assert.equal(emails.length, 0)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'confirmed')
})

test('legacy migration is dry by default, preserves history, and is idempotent when explicitly applied', async () => {
  const legacyId = new mongoose.Types.ObjectId()
  await RentalRequest.collection.insertOne({ _id: legacyId, customerId: customer._id, items: [{ decision: 'accepted' }], statusHistory: [] })
  const script = fileURLToPath(new URL('../scripts/migrateRentalHandover.mjs', import.meta.url))
  const execute = promisify(execFile)
  const options = { env: { ...process.env, MONGO_URI: mongo.getUri('rentease_verification_tests') } }
  const dry = await execute(process.execPath, [script], options)
  assert.equal(JSON.parse(dry.stdout).recordsMissingStatus, 1)
  assert.equal((await RentalRequest.collection.findOne({ _id: legacyId })).status, undefined)
  await execute(process.execPath, [script, '--apply'], options)
  const migrated = await RentalRequest.collection.findOne({ _id: legacyId })
  assert.equal(migrated.status, 'confirmed')
  assert.equal(migrated.pickupVerifiedAt, undefined)
  assert.equal(migrated.statusHistory.length, 1)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'confirmed')
  const again = await execute(process.execPath, [script, '--apply'], options)
  assert.equal(JSON.parse(again.stdout).modified, 0)
  assert.equal((await RentalRequest.collection.findOne({ _id: legacyId })).statusHistory.length, 1)
})

test('customer rental details enforce ownership and reject anonymous, malformed, and foreign requests', async () => {
  const customerHeaders = { Authorization: `Bearer ${createSession(customer._id)}` }
  const path = `/api/requests/${rental._id}`
  assert.equal((await request(app).get(path)).status, 401)
  const mine = await request(app).get(path).set(customerHeaders)
  assert.equal(mine.status, 200)
  assert.equal(String(mine.body.rental._id), String(rental._id))
  assert.equal(mine.headers['cache-control'], 'private, no-store')
  assert.equal((await request(app).get(path).set(headers)).status, 404)
  assert.equal((await request(app).get('/api/requests/not-an-id').set(customerHeaders)).status, 400)
  assert.equal((await request(app).get(`/api/requests/${new mongoose.Types.ObjectId()}`).set(customerHeaders)).status, 404)
  const otherRental = await RentalRequest.create({ ...rental.toObject(), _id: new mongoose.Types.ObjectId(), customerId: admin._id })
  assert.equal((await request(app).get(`/api/requests/${otherRental._id}`).set(customerHeaders)).status, 404)
  const list = await request(app).get('/api/requests').set(customerHeaders)
  assert.deepEqual(list.body.requests.map((row) => row._id), [String(rental._id)])
})

test('customer detail DTOs preserve booked prices, include multiple inactive products, and exclude private fields', async () => {
  await Product.updateOne({ _id: product._id }, { $set: { active: false, description: 'Full original camera details', specifications: [{ name: 'Sensor', value: 'Full frame' }], photos: ['/front.jpg', '/back.jpg'], dailyRate: 9999 } })
  const second = await Product.create({ title: 'Tripod', category: 'Accessories', description: 'Adjustable tripod', dailyRate: 500, photos: ['/tripod.jpg'], createdBy: admin._id })
  await RentalRequest.updateOne({ _id: rental._id }, { $push: { items: { productId: second._id, providerId: admin._id, title: 'Booked tripod', dailyRate: 500, rentalAmount: 500, decision: 'accepted' }, statusHistory: { status: 'confirmed', by: admin._id, verificationId: 'private-verification-reference', note: 'private staff note' } }, $set: { 'payment.idempotencyKey': 'private-key', 'payment.transactionId': 'private-transaction', pickupVerifiedBy: admin._id } })
  const response = await request(app).get(`/api/requests/${rental._id}`).set({ Authorization: `Bearer ${createSession(customer._id)}` })
  assert.equal(response.status, 200)
  assert.equal(response.body.rental.items.length, 2)
  assert.equal(response.body.rental.items[0].rentalAmount, 2500)
  assert.equal(response.body.rental.items[0].product.description, 'Full original camera details')
  assert.equal(response.body.rental.items[0].product.photos.length, 2)
  assert.equal(response.body.rental.items[1].quantity, 1)
  for (const field of ['private-key', 'private-transaction', 'private staff note', 'private-verification-reference', 'pickupVerifiedBy', 'providerId', 'handover', 'otpHash']) assert.equal(JSON.stringify(response.body).includes(field), false, field)
  const listing = await request(app).get('/api/requests').set({ Authorization: `Bearer ${createSession(customer._id)}` })
  assert.equal(listing.body.requests[0].items[0].image, '/front.jpg')
})

test('customer details reflect actual pickup and return OTP transitions without leaking verification records', async () => {
  const customerHeaders = { Authorization: `Bearer ${createSession(customer._id)}` }
  const path = `/api/requests/${rental._id}`
  const pickup = await send(); await verify(pickup.body)
  const active = await request(app).get(path).set(customerHeaders)
  assert.equal(active.body.rental.status, 'active')
  assert.ok(active.body.rental.pickupVerifiedAt)
  assert.equal(active.body.rental.returnVerifiedAt, null)
  const returned = await send(rental._id, 'return'); await verify(returned.body, emails.at(-1).code, 'return')
  const completed = await request(app).get(path).set(customerHeaders)
  assert.equal(completed.body.rental.status, 'returned')
  assert.ok(completed.body.rental.returnVerifiedAt)
  assert.equal(JSON.stringify(completed.body).includes('challengeId'), false)
  assert.equal(JSON.stringify(completed.body).includes(String(admin._id)), false)
})

test('deleted catalog items leave customer booking prices and names accessible with a safe image fallback', async () => {
  await Product.deleteOne({ _id: product._id })
  const response = await request(app).get(`/api/requests/${rental._id}`).set({ Authorization: `Bearer ${createSession(customer._id)}` })
  assert.equal(response.status, 200)
  assert.equal(response.body.rental.items[0].title, 'Rental camera')
  assert.equal(response.body.rental.items[0].rentalAmount, 2500)
  assert.equal(response.body.rental.items[0].product, null)
  assert.equal(response.body.rental.items[0].image, null)
})

test('customer rental listing includes owned bookings beyond the old 100-record cap', async () => {
  await RentalRequest.insertMany(Array.from({ length: 101 }, () => ({ ...rental.toObject(), _id: new mongoose.Types.ObjectId() })))
  const response = await request(app).get('/api/requests').set({ Authorization: `Bearer ${createSession(customer._id)}` })
  assert.equal(response.status, 200)
  assert.equal(response.body.requests.length, 102)
  assert.ok(response.body.requests.every((row) => row.items[0].image === '/test-camera.jpg'))
})
