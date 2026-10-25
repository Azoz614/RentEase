import { before, after, beforeEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import sharp from 'sharp'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { User } from '../src/modules/users/user.model.mjs'
import { IdentityVerification, IdentityDispute } from '../src/modules/identity/identity.model.mjs'
import { RentalRequest } from '../src/modules/rentals/rental.model.mjs'
import { Product } from '../src/modules/products/product.model.mjs'
import { Notification } from '../src/modules/notifications/notification.model.mjs'
import { VerificationRate } from '../src/modules/otp/verification-rate.model.mjs'
import { AuditLog } from '../src/modules/admin/audit-log.model.mjs'
import { createSession } from '../src/middleware/auth.mjs'
import identityRoutes from '../src/modules/identity/identity.routes.js'
import rentalRoutes from '../src/routes/marketplace.routes.js'
import adminRoutes from '../src/modules/admin/admin.routes.js'
import { createCustomerPickupRouter } from '../src/modules/rentals/customer-handover.routes.js'
import { createRentalVerificationRouter } from '../src/modules/rentals/handover.routes.js'
import { parseNic } from '../src/modules/identity/identity-security.service.mjs'
import { migrateCustomerIdentity } from '../scripts/migrateCustomerIdentity.mjs'
import { purgeIdentityDocuments } from '../scripts/purgeIdentityDocuments.mjs'

let mongo, app, directory, admin, customer, other, product, image, passwordHash
let emails = []
const password = 'Test-Password-Only-2026!'
const address = { line1: '12 Example Lane', line2: '', city: 'Colombo', district: 'Colombo', province: 'Western', postalCode: '00100', country: 'Sri Lanka' }
const auth = (user = customer) => ({ Authorization: `Bearer ${createSession(user._id)}` })
const body = (extra = {}) => ({ fullName: 'Example Customer', nic: '200000100001', dateOfBirth: '2000-01-01', phone: '0771234567', address, front: image, back: image, consent: true, password, ...extra })
const submit = (extra, user = customer) => request(app).post('/api/identity/submit').set(auth(user)).send(body(extra))
async function decision(value = 'approved', reason = '') {
  const identity = await IdentityVerification.findOne({ userId: customer._id })
  return request(app).post(`/api/admin/customer-verifications/${identity._id}/decision`).set(auth(admin)).send({ decision: value, reason, revision: identity.revision })
}
const bookingBody = () => ({ productIds: [String(product._id)], startDate: new Date(Date.now() + 72 * 3600000).toISOString(), endDate: new Date(Date.now() + 96 * 3600000).toISOString(), deliveryMethod: 'pickup' })
const book = () => request(app).post('/api/requests').set(auth()).send(bookingBody())

before(async () => {
  process.env.SESSION_SECRET = randomBytes(32).toString('hex')
  process.env.RENTAL_OTP_SECRET = randomBytes(32).toString('hex')
  process.env.IDENTITY_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  process.env.IDENTITY_HASH_KEY = randomBytes(32).toString('base64')
  process.env.SMTP_HOST = ''
  process.env.GOOGLE_MAPS_API_KEY = ''
  directory = await mkdtemp(path.join(tmpdir(), 'rentease-identity-tests-'))
  process.env.IDENTITY_STORAGE_DIR = directory
  image = `data:image/png;base64,${(await sharp({ create: { width: 400, height: 250, channels: 3, background: '#aaccee' } }).png().toBuffer()).toString('base64')}`
  passwordHash = await bcrypt.hash(password, 10)
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('rentease_identity_tests'))
  await Promise.all([User.init(), IdentityVerification.init(), IdentityDispute.init(), RentalRequest.init(), Product.init(), Notification.init(), VerificationRate.init(), AuditLog.init()])
  const mail = { sendEmail: async (email, code, type) => { emails.push({ email, code, type }) } }
  app = express(); app.use(express.json({ limit: '22mb' })); app.use('/api', identityRoutes); app.use('/api/admin', createRentalVerificationRouter(mail)); app.use('/api/admin', adminRoutes); app.use('/api', createCustomerPickupRouter(mail)); app.use('/api', rentalRoutes)
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.name }))
}, { timeout: 180000 })
beforeEach(async () => {
  mock.restoreAll(); emails = []
  await Promise.all([User.deleteMany({}), IdentityVerification.deleteMany({}), IdentityDispute.deleteMany({}), RentalRequest.deleteMany({}), Product.deleteMany({}), Notification.deleteMany({}), VerificationRate.deleteMany({}), AuditLog.deleteMany({})])
  admin = await User.create({ username: 'Verification Admin', email: 'admin@example.test', phone: '0771234566', password: passwordHash, role: 'admin' })
  customer = await User.create({ username: 'Example Customer', email: 'customer@example.test', phone: '0771234567', password: passwordHash })
  other = await User.create({ username: 'Another Customer', email: 'another@example.test', phone: '0771234568', password: passwordHash })
  product = await Product.create({ title: 'Example camera', category: 'Cameras', description: 'Camera fixture', photos: ['/camera.jpg'], dailyRate: 2500, providerId: admin._id, createdBy: admin._id })
})
after(async () => {
  await mongoose.disconnect(); await mongo?.stop()
  const base = path.resolve(tmpdir()) + path.sep, target = path.resolve(directory || '.')
  if (target.startsWith(base) && path.basename(target).startsWith('rentease-identity-tests-')) await rm(target, { recursive: true, force: true })
})

test('unverified, pending and rejected customers cannot create rentals through direct API requests', async () => {
  assert.equal((await book()).body.code, 'IDENTITY_REQUIRED')
  assert.equal((await submit()).status, 201)
  const pending = await book(); assert.equal(pending.status, 403); assert.equal(pending.body.code, 'IDENTITY_PENDING')
  assert.equal((await decision('rejected', 'Photo is blurred. Upload a clearer card image.')).status, 200)
  const rejected = await book(); assert.equal(rejected.status, 403); assert.match(rejected.body.message, /Photo is blurred/)
  assert.equal(await RentalRequest.countDocuments(), 0)
})

test('identity validation rejects incomplete address, unsafe photos, bad NIC, wrong DOB and missing consent', async () => {
  for (const extra of [{ nic: 'not-a-nic' }, { dateOfBirth: '1999-01-01' }, { address: { ...address, city: '' } }, { consent: false }, { front: 'data:image/png;base64,PGh0bWw+PC9odG1sPg==' }]) {
    const response = await submit(extra)
    assert.equal(response.status, 400, JSON.stringify(response.body))
  }
  assert.equal(await IdentityVerification.countDocuments(), 0)
})

test('NIC normalization maps old/new equivalents to one private duplicate claim', async () => {
  assert.equal(parseNic('90 001-0001v').canonical, '199000100001')
  assert.equal(parseNic('900010001X').digest, parseNic('199000100001').digest)
  assert.equal((await submit({ nic: '900010001v', dateOfBirth: '1990-01-01' })).status, 201)
  const duplicate = await submit({ nic: '199000100001', dateOfBirth: '1990-01-01' }, other)
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.body.code, 'DUPLICATE_NIC')
  assert.equal(JSON.stringify(duplicate.body).includes(customer.email), false)
  const own = await request(app).post('/api/identity/check-nic').set(auth()).send({ nic: '199000100001' })
  assert.equal(own.status, 200)
})

test('concurrent duplicate submissions create exactly one NIC reservation at the database level', async () => {
  const responses = await Promise.all([submit(), submit({}, other)])
  assert.equal(responses.filter((response) => response.status === 201).length, 1)
  assert.equal(responses.filter((response) => response.status === 409).length, 1)
  assert.equal(await IdentityVerification.countDocuments(), 1)
})

test('photos and NICs are encrypted privately; document access is owner/admin only and audited', async () => {
  assert.equal((await submit()).status, 201)
  const identity = await IdentityVerification.findOne({ userId: customer._id }).select('+front +back +nicEncrypted +nicDigest').lean()
  assert.notEqual(identity.nicEncrypted, body().nic)
  const encryptedPhoto = await readFile(path.join(directory, identity.front.filename))
  assert.equal(encryptedPhoto.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), false)
  const own = await request(app).get('/api/identity/documents/front').set(auth())
  assert.equal(own.status, 200); assert.equal(own.headers['content-type'], 'image/png'); assert.match(own.headers['cache-control'], /no-store/)
  assert.equal((await request(app).get('/api/identity/documents/front').set(auth(other))).status, 404)
  assert.equal((await request(app).get(`/api/admin/customer-verifications/${identity._id}/documents/front`).set(auth(other))).status, 403)
  assert.equal((await request(app).get(`/api/admin/customer-verifications/${identity._id}/documents/front`).set(auth(admin))).status, 200)
  assert.equal((await request(app).get('/api/identity/documents/front')).status, 401)
  const list = await request(app).get('/api/admin/customer-verifications?status=pending').set(auth(admin))
  assert.equal(JSON.stringify(list.body).includes(body().nic), false)
  assert.equal(JSON.stringify(list.body).includes('nicEncrypted'), false)
  assert.equal(await AuditLog.countDocuments({ action: 'identity.document.viewed' }), 1)
})

test('administrator approval sends private notifications and enables the actual booking workflow', async () => {
  await submit()
  assert.equal((await decision()).status, 200)
  const notice = await Notification.findOne({ userId: customer._id, title: 'Identity Verification Approved' }).lean()
  assert.ok(notice); assert.equal(notice.link, 'verification'); assert.equal(JSON.stringify(notice).includes(body().nic), false)
  const booking = await book()
  assert.equal(booking.status, 201, JSON.stringify(booking.body))
  assert.equal(booking.body.request.addressSnapshot.line1, address.line1)
  assert.equal(booking.body.request.requiresPickupPreparation, true)
  assert.equal((await decision()).status, 409)
  const inbox = await request(app).get('/api/inbox').set(auth())
  assert.ok(inbox.body.notifications.some((row) => row.title === 'Identity Verification Approved'))
  assert.equal((await request(app).patch(`/api/notifications/${notice._id}`).set(auth(other)).send({ read: true })).status, 404)
  assert.equal((await request(app).patch(`/api/notifications/${notice._id}`).set(auth()).send({ read: true })).body.notification.readAt !== null, true)
})

test('customer requests reach both the owning shop and every administrator, never an unrelated shop', async () => {
  const shop = await User.create({ username: 'Camera Shop', email: 'camera-shop@example.test', phone: '0771111222', password: passwordHash, role: 'rental_shop', shopStatus: 'approved' })
  const stranger = await User.create({ username: 'Unrelated Shop', email: 'unrelated-shop@example.test', phone: '0771111333', password: passwordHash, role: 'rental_shop', shopStatus: 'approved' })
  await Product.updateOne({ _id: product._id }, { $set: { providerId: shop._id } })
  await submit(); await decision()
  const created = await book()
  assert.equal(created.status, 201)
  const id = created.body.request._id
  const list = (user) => request(app).get('/api/provider/requests').set(auth(user))
  for (const user of [admin, shop]) {
    const result = await list(user)
    assert.equal(result.status, 200)
    assert.ok(result.body.requests.some((row) => row._id === id))
    assert.match(result.headers['cache-control'], /no-store/)
    assert.ok(await Notification.exists({ userId: user._id, requestId: id, title: 'New rental request' }))
  }
  assert.equal((await list(stranger)).body.requests.length, 0)
  assert.equal((await list(customer)).status, 403)
  assert.equal((await request(app).get('/api/provider/requests')).status, 401)
  const legacyAdmin = await request(app).get('/api/admin/rental-requests').set(auth(admin))
  assert.ok(legacyAdmin.body.requests.some((row) => row._id === id))
  const change = (user) => request(app).patch(`/api/provider/requests/${id}/items/${product._id}`).set(auth(user)).send({ decision: 'accepted' })
  assert.equal((await change(stranger)).status, 404)
  assert.equal((await change(admin)).status, 200)
  assert.equal((await change(shop)).status, 409)
})

test('a mixed-provider booking exposes only each shop own items while admin sees every item', async () => {
  const shops = await User.create([
    { username: 'First Shop', email: 'first-shop@example.test', phone: '0771111222', password: passwordHash, role: 'rental_shop', shopStatus: 'approved' },
    { username: 'Second Shop', email: 'second-shop@example.test', phone: '0771111333', password: passwordHash, role: 'rental_shop', shopStatus: 'approved' },
  ])
  await Product.updateOne({ _id: product._id }, { $set: { providerId: shops[0]._id } })
  const second = await Product.create({ title: 'Example tripod', category: 'Cameras', description: 'Tripod fixture', photos: ['/tripod.jpg'], dailyRate: 500, providerId: shops[1]._id, createdBy: admin._id })
  await submit(); await decision()
  const created = await request(app).post('/api/requests').set(auth()).send({ ...bookingBody(), productIds: [String(product._id), String(second._id)] })
  assert.equal(created.status, 201)
  for (const shop of shops) {
    const result = await request(app).get('/api/provider/requests').set(auth(shop))
    assert.equal(result.body.requests.length, 1)
    assert.equal(result.body.requests[0].items.length, 1)
    assert.equal(result.body.requests[0].items[0].providerId, String(shop._id))
  }
  const adminList = await request(app).get('/api/provider/requests').set(auth(admin))
  assert.equal(adminList.body.requests[0].items.length, 2)
})

test('legacy orphaned provider references remain visible and reviewable by an administrator without reassigning ownership', async () => {
  const shop = await User.create({ username: 'Previous Shop', email: 'previous-shop@example.test', phone: '0771111222', password: passwordHash, role: 'rental_shop', shopStatus: 'approved' })
  await Product.updateOne({ _id: product._id }, { $set: { providerId: shop._id } })
  await submit(); await decision()
  const created = await book(), id = created.body.request._id
  await User.deleteOne({ _id: shop._id })
  const result = await request(app).get('/api/provider/requests').set(auth(admin))
  assert.equal(result.body.requests[0]._id, id)
  assert.equal(result.body.requests[0].items[0].providerId, String(shop._id))
  const reviewed = await request(app).patch(`/api/provider/requests/${id}/items/${product._id}`).set(auth(admin)).send({ decision: 'accepted' })
  assert.equal(reviewed.status, 200)
  assert.equal((await RentalRequest.findById(id)).status, 'confirmed')
  assert.equal(String((await Product.findById(product._id)).providerId), String(shop._id))
})

test('reject and resubmit preserves feedback history and allows correction of the same NIC', async () => {
  await submit(); await decision('rejected', 'Replace the front photograph; all four corners must be visible.')
  const resubmission = await submit({ fullName: 'Corrected Legal Name' })
  assert.equal(resubmission.status, 201, JSON.stringify(resubmission.body))
  const identity = await IdentityVerification.findOne({ userId: customer._id })
  assert.equal(identity.revision, 2)
  assert.ok(identity.history.some((event) => event.status === 'rejected'))
  assert.equal(identity.history.at(-1).previousStatus, 'rejected')
  assert.equal((await decision('resubmission_required', 'Please provide a sharper reverse-side image.')).status, 200)
  assert.equal((await book()).status, 403)
})

test('required rejection reason and self-approval protections cannot be bypassed', async () => {
  await submit()
  assert.equal((await decision('rejected')).status, 400)
  await User.updateOne({ _id: customer._id }, { $set: { role: 'admin' } })
  const identity = await IdentityVerification.findOne({ userId: customer._id })
  const own = await request(app).post(`/api/admin/customer-verifications/${identity._id}/decision`).set(auth()).send({ decision: 'approved', revision: 1 })
  assert.equal(own.status, 403)
})

test('address changes require password, preserve NIC approval and leave rental snapshots immutable', async () => {
  await submit(); await decision(); const booking = await book()
  const addressId = (await User.findById(customer._id)).defaultAddressId
  const wrong = await request(app).put(`/api/addresses/${addressId}`).set(auth()).send({ address: { ...address, line1: '99 Another Road' }, password: 'incorrect-password' })
  assert.equal(wrong.status, 401); assert.equal(wrong.body.message, 'Incorrect password. Please try again.')
  const updated = await request(app).put(`/api/addresses/${addressId}`).set(auth()).send({ address: { ...address, line1: '99 Another Road' }, password })
  assert.equal(updated.status, 200, JSON.stringify(updated.body))
  const profile = await request(app).get('/api/identity/status').set(auth())
  assert.equal(profile.body.status, 'approved'); assert.equal(profile.body.defaultAddress.line1, '99 Another Road')
  const snapshot = await RentalRequest.findById(booking.body.request._id)
  assert.equal(snapshot.addressSnapshot.line1, '12 Example Lane')
  assert.equal((await request(app).put('/api/address').set(auth()).send({ address: 'Bypassed address' })).status, 409)
  assert.equal((await request(app).put('/api/profile').set(auth()).send({ nic: body().nic, address: 'Bypassed address', password })).status, 409)
})

test('password confirmation is rate limited without storing supplied passwords', async () => {
  for (let index = 0; index < 5; index += 1) assert.equal((await request(app).post('/api/addresses').set(auth()).send({ address, password: 'wrong-password' })).status, 401)
  assert.equal((await request(app).post('/api/addresses').set(auth()).send({ address, password })).status, 429)
  assert.equal(await AuditLog.countDocuments(), 0)
  assert.equal(JSON.stringify(await VerificationRate.find().lean()).includes('wrong-password'), false)
})

test('new approved rentals require readiness, email verification, physical handover and inspected return', async () => {
  await submit(); await decision(); const created = await book(), id = created.body.request._id
  assert.equal(created.status, 201)
  const accepted = await request(app).patch(`/api/provider/requests/${id}/items/${product._id}`).set(auth(admin)).send({ decision: 'accepted' })
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body))
  assert.equal((await request(app).patch(`/api/provider/requests/${id}/items/${product._id}`).set(auth(admin)).send({ decision: 'accepted' })).status, 409)
  assert.equal((await request(app).post(`/api/requests/${id}/payments`).set(auth()).set('Idempotency-Key', 'identity-workflow-test-0001').send({})).status, 200)
  assert.equal((await request(app).post(`/api/requests/${id}/pickup/send`).set(auth()).send({})).body.code, 'PICKUP_NOT_READY')
  assert.equal((await request(app).post(`/api/admin/rentals/${id}/ready`).set(auth(admin)).send({})).status, 200)
  const pickup = await request(app).post(`/api/requests/${id}/pickup/send`).set(auth()).send({})
  const verified = await request(app).post(`/api/requests/${id}/pickup/verify`).set(auth()).send({ challengeId: pickup.body.challengeId, code: emails.at(-1).code })
  assert.equal(verified.body.rental.status, 'confirmed')
  assert.equal((await request(app).post(`/api/admin/rentals/${id}/handover/confirm`).set(auth(admin)).send({})).body.rental.status, 'active')
  const returned = await request(app).post(`/api/admin/rentals/${id}/verification/return/send`).set(auth(admin)).send({})
  const returnVerified = await request(app).post(`/api/admin/rentals/${id}/verification/return/verify`).set(auth(admin)).send({ challengeId: returned.body.challengeId, code: emails.at(-1).code })
  assert.equal(returnVerified.body.rental.status, 'active')
  assert.equal((await Product.findById(product._id)).rentalSlots.length, 1)
  assert.equal((await request(app).post(`/api/admin/rentals/${id}/return/confirm`).set(auth(admin)).send({})).status, 400)
  assert.equal((await request(app).post(`/api/admin/rentals/${id}/return/confirm`).set(auth(admin)).send({ inspectionNote: 'Received all items, inspected camera and lens; no visible damage.' })).body.rental.status, 'returned')
  assert.equal((await Product.findById(product._id)).rentalSlots.length, 0)
  assert.equal((await request(app).post(`/api/admin/rentals/${id}/complete`).set(auth(admin)).send({})).status, 200)
  assert.equal((await RentalRequest.findById(id)).status, 'completed')
})

test('rejected rental items require feedback, release inventory and notify the customer', async () => {
  await submit(); await decision(); const created = await book(), id = created.body.request._id
  assert.equal((await request(app).patch(`/api/provider/requests/${id}/items/${product._id}`).set(auth(admin)).send({ decision: 'rejected' })).status, 400)
  const declined = await request(app).patch(`/api/provider/requests/${id}/items/${product._id}`).set(auth(admin)).send({ decision: 'rejected', reason: 'The item needs scheduled maintenance.' })
  assert.equal(declined.status, 200)
  assert.equal(declined.body.request.status, 'cancelled')
  assert.equal(declined.body.request.items[0].decisionReason, 'The item needs scheduled maintenance.')
  assert.equal((await Product.findById(product._id)).rentalSlots.length, 0)
  assert.ok(await Notification.exists({ userId: customer._id, title: 'Rental Request Rejected' }))
})

test('identity decision audit failure rolls back approval and notifications', async () => {
  await submit()
  mock.method(AuditLog, 'create', async () => { throw new Error('Test rollback') })
  assert.equal((await decision()).status, 500)
  assert.equal((await IdentityVerification.findOne({ userId: customer._id })).status, 'pending')
  assert.equal(await Notification.countDocuments({ title: 'Identity Verification Approved' }), 0)
})

test('booking audit failure rolls back the request, reservation and recipient notifications together', async () => {
  await submit(); await decision()
  const beforeCount = await Notification.countDocuments()
  mock.method(AuditLog, 'create', async () => { throw new Error('Test booking rollback') })
  assert.equal((await book()).status, 500)
  assert.equal(await RentalRequest.countDocuments(), 0)
  assert.equal((await Product.findById(product._id)).rentalSlots.length, 0)
  assert.equal(await Notification.countDocuments(), beforeCount)
})

test('concurrent administrator decisions commit one review and do not overwrite its history', async () => {
  await submit()
  const results = await Promise.all([decision(), decision('rejected', 'The card image needs a clearer replacement.')])
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409])
  const identity = await IdentityVerification.findOne({ userId: customer._id })
  // The revision identifies the submission; reviewing it adds a single history event.
  assert.equal(identity.revision, 1)
  assert.equal(identity.history.length, 2)
  assert.equal(await AuditLog.countDocuments({ action: { $in: ['identity.approved', 'identity.rejected'] } }), 1)
})

test('legacy identity migration is dry by default, handles missing roles and never invents approval', async () => {
  const legacyId = new mongoose.Types.ObjectId()
  await User.collection.insertOne({ _id: legacyId, username: 'Legacy Customer', email: 'legacy@example.test', phone: '0771111111', password: passwordHash, nic: '900010001v', identityStatus: 'approved' })
  const preview = await migrateCustomerIdentity()
  assert.equal(preview.recordsRequiringSecureResubmission, 1)
  assert.equal(await IdentityVerification.countDocuments(), 0)
  const applied = await migrateCustomerIdentity({ apply: true })
  assert.equal(applied.modified, 1)
  const migrated = await IdentityVerification.findOne({ userId: legacyId }).select('+nicEncrypted +nicDigest')
  assert.equal(migrated.status, 'resubmission_required')
  assert.ok(migrated.nicEncrypted)
  assert.equal(migrated.dateOfBirth, undefined)
  assert.equal((await User.collection.findOne({ _id: legacyId })).nic, undefined)
  assert.equal((await migrateCustomerIdentity({ apply: true })).modified, 0)
})

test('migration detects duplicate old/new NICs before making any changes', async () => {
  await User.updateOne({ _id: customer._id }, { $set: { nic: '900010001V' } })
  await User.updateOne({ _id: other._id }, { $set: { nic: '199000100001' } })
  assert.equal((await migrateCustomerIdentity()).duplicateGroups, 1)
  await assert.rejects(migrateCustomerIdentity({ apply: true }), /Duplicate normalized NIC groups/)
  assert.equal(await IdentityVerification.countDocuments(), 0)
})

test('expired photo retention is preview-only until explicitly applied and preserves decisions', async () => {
  await submit(); await decision()
  await IdentityVerification.updateOne({ userId: customer._id }, { $set: { retentionUntil: new Date(Date.now() - 1000) } })
  assert.equal((await purgeIdentityDocuments()).expiredSubmissions, 1)
  assert.equal((await request(app).get('/api/identity/documents/front').set(auth())).status, 200)
  assert.equal((await purgeIdentityDocuments({ apply: true })).purged, 1)
  assert.equal((await request(app).get('/api/identity/documents/front').set(auth())).status, 404)
  assert.equal((await IdentityVerification.findOne({ userId: customer._id })).status, 'approved')
  assert.equal((await book()).status, 201)
})

test('a legitimate duplicate claim requires password-authorized admin recovery and never auto-approves', async () => {
  await submit(); await decision()
  assert.equal((await submit({}, other)).status, 409)
  const claim = await request(app).post('/api/identity/disputes').set(auth(other)).send({ nic: body().nic, message: 'Please investigate an existing claim after reviewing my original documents privately.' })
  assert.equal(claim.status, 201)
  const listing = await request(app).get('/api/admin/customer-verifications/disputes').set(auth(admin))
  const id = listing.body.disputes[0]._id
  assert.equal(JSON.stringify(listing.body).includes(body().nic), false)
  assert.equal((await request(app).post(`/api/admin/customer-verifications/disputes/${id}/resolve`).set(auth(other)).send({})).status, 403)
  const resolved = await request(app).post(`/api/admin/customer-verifications/disputes/${id}/resolve`).set(auth(admin)).send({ password, releaseExistingClaim: true, reason: 'Independent evidence reviewed and account recovery coordinated with both account holders.' })
  assert.equal(resolved.status, 200, JSON.stringify(resolved.body))
  assert.equal((await IdentityVerification.findOne({ userId: customer._id })).status, 'resubmission_required')
  assert.equal((await submit({}, other)).status, 201)
  assert.equal((await IdentityVerification.findOne({ userId: other._id })).status, 'pending')
})
