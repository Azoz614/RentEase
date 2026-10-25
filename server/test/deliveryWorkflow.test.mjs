import { before, after, beforeEach, test, mock } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { User } from '../src/modules/users/user.model.mjs'
import { RentalRequest } from '../src/modules/rentals/rental.model.mjs'
import { Product } from '../src/modules/products/product.model.mjs'
import { DeliveryTask } from '../src/modules/delivery/delivery-task.model.mjs'
import { PartnerPresence } from '../src/modules/delivery/partner-presence.model.mjs'
import { DeliveryLocation } from '../src/modules/delivery/delivery-location.model.mjs'
import { Notification } from '../src/modules/notifications/notification.model.mjs'
import { AuditLog } from '../src/modules/admin/audit-log.model.mjs'
import { VerificationRate } from '../src/modules/otp/verification-rate.model.mjs'
import { createDeliveryTasks, broadcastAvailableTasks, assignDelivery, acceptTask, listTasks, SEARCH_RADII,
  markReady, sendTaskOtp, verifyTaskOtp, progressTask, quoteReturn, requestReturn,
} from '../src/modules/delivery/delivery-task.service.mjs'
import { sendSelfReturn, verifySelfReturn, selfReturnState } from '../src/modules/rentals/self-return.service.mjs'

let mongo, customer, shop, rider, otherRider, rental, product
const origin = { type: 'Point', coordinates: [79.8612, 6.9271] }
const destination = { address: '30 Customer Road, Colombo', location: { type: 'Point', coordinates: [79.88, 6.94] } }
let emails = []
const capture = async (email, code) => { emails.push({ email, code }) }
const lastCode = () => emails.at(-1).code
const account = (username, role) => User.create({ username, role, email: username + '@example.test',
  password: 'isolated-test-password', phone: '0701234567', active: true,
  ...(role === 'rental_shop' ? { shopStatus: 'approved', shopLocation: origin, shopAddress: '12 Shop Road, Colombo' } : {}) })
const input = (response, kind, code = lastCode()) => ({ challengeId: response.challengeId, kind, code })
const presence = (partner, location = origin) => PartnerPresence.create({ partnerId: partner._id,
  location, accuracy: 10, online: true, updatedAt: new Date(), expiresAt: new Date(Date.now() + 90000) })
const reloadActor = (actor) => User.findById(actor._id)
const expectCode = async (promise, code) => assert.rejects(promise, (e) => e.code === code)

before(async () => {
  process.env.RENTAL_OTP_SECRET = 'isolated-delivery-test-secret'
  process.env.SESSION_SECRET = 'isolated-test-session-secret'
  process.env.GEOAPIFY_API_KEY = 'isolated-routing-test-key'
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
  await mongoose.connect(mongo.getUri('delivery_workflow_tests'))
  await Promise.all([User, RentalRequest, Product, DeliveryTask, PartnerPresence, DeliveryLocation, Notification,
    AuditLog, VerificationRate].map((model) => model.init()))
}, { timeout: 180000 })
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })
beforeEach(async () => {
  mock.restoreAll()
  emails = []
  await Promise.all([User, RentalRequest, Product, DeliveryTask, PartnerPresence, DeliveryLocation,
    Notification, AuditLog, VerificationRate].map((model) => model.deleteMany({})))
  customer = await account('customer', 'user')
  shop = await account('shop', 'rental_shop')
  rider = await account('rider', 'delivery_partner')
  otherRider = await account('other-rider', 'delivery_partner')
  product = await Product.create({ title: 'Camera', category: 'Cameras', description: 'Delivery test inventory',
    dailyRate: 2500, photos: ['/isolated-test-camera.jpg'], createdBy: shop._id, providerId: shop._id })
  rental = await RentalRequest.create({ customerId: customer._id, items: [{ productId: product._id,
    providerId: shop._id, title: product.title, decision: 'accepted', rentalAmount: 2500 }],
    startDate: new Date(), endDate: new Date(Date.now() + 86400000), deliveryMethod: 'partner',
    deliveryWorkflowVersion: 2, deliveryDestination: destination,
    shipments: [{ providerId: shop._id, origin, shopAddress: shop.shopAddress, distanceKm: 4.2, fee: 210, returnFee: 0 }],
    subtotal: 2500, total: 2710, status: 'confirmed', payment: { status: 'authorized' } })
})

async function assign() {
  await presence(rider)
  await assignDelivery(rental._id, customer)
  const task = await DeliveryTask.findOne({ rentalId: rental._id, direction: 'delivery' })
  await acceptTask(task._id, rider)
  return task
}

test('approval creates waiting tasks; only the owner can explicitly start dispatch after approval', async () => {
  await presence(rider)
  await createDeliveryTasks(rental)
  await broadcastAvailableTasks()
  let task = await DeliveryTask.findOne({ rentalId: rental._id })
  assert.equal(task.search.state, 'waiting')
  assert.equal(task.offeredPartnerIds.length, 0)
  await expectCode(assignDelivery(rental._id, rider), 'CUSTOMER_REQUIRED')
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { status: 'pending' } })
  await expectCode(assignDelivery(rental._id, customer), 'APPROVAL_REQUIRED')
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { status: 'confirmed' } })
  await assignDelivery(rental._id, customer)
  await assignDelivery(rental._id, customer)
  assert.equal(await DeliveryTask.countDocuments({ rentalId: rental._id }), 1)
  task = await DeliveryTask.findById(task._id)
  assert.equal(task.offeredPartnerIds.length, 1)
  assert.equal(await Notification.countDocuments({ type: 'delivery_offer' }), 1)
})

test('persistent search expands to distant eligible riders; concurrent acceptance has exactly one winner', async () => {
  await presence(rider)
  await presence(otherRider, { type: 'Point', coordinates: [79.92, 6.9271] })
  await assignDelivery(rental._id, customer)
  let task = await DeliveryTask.findOne({ rentalId: rental._id })
  assert.deepEqual(task.offeredPartnerIds.map(String), [String(rider._id)])
  for (let round = 0; round < 2; round++) {
    await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'search.nextExpansionAt': new Date(0) } })
    await broadcastAvailableTasks()
  }
  task = await DeliveryTask.findById(task._id)
  assert.equal(task.search.radiusMeters, 10000)
  assert.equal(task.offeredPartnerIds.length, 2)
  const results = await Promise.allSettled([acceptTask(task._id, rider), acceptTask(task._id, otherRider)])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  const winner = await DeliveryTask.findById(task._id)
  assert.equal(winner.status, 'assigned')
  assert.equal(await User.countDocuments({ activeDeliveryTask: task._id }), 1)
  assert.equal(await Notification.countDocuments({ type: 'delivery_offer' }), 0)
  const loser = String(winner.assignedPartner) === String(rider._id) ? otherRider : rider
  assert.equal((await listTasks(await reloadActor(loser))).tasks.length, 0)
})

test('search exhausts without inventing a rider and can restart without duplicating tasks', async () => {
  await assignDelivery(rental._id, customer)
  const task = await DeliveryTask.findOne({ rentalId: rental._id })
  for (let round = 0; round < SEARCH_RADII.length; round++) {
    await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'search.nextExpansionAt': new Date(0) } })
    await broadcastAvailableTasks()
  }
  const exhausted = await DeliveryTask.findById(task._id)
  assert.equal(exhausted.search.state, 'exhausted')
  assert.equal(exhausted.assignedPartner, null)
  assert.equal(exhausted.offeredPartnerIds.length, 0)
  await presence(rider)
  await assignDelivery(rental._id, customer)
  assert.equal(await DeliveryTask.countDocuments({ rentalId: rental._id }), 1)
  assert.equal((await DeliveryTask.findById(task._id)).offeredPartnerIds.length, 1)
})

test('all four handovers use the requested email recipient and verifier, consume real random codes once, and update rental custody', async () => {
  const task = await assign()
  await markReady(task._id, shop)
  await expectCode(progressTask(task._id, 'delivered', rider), 'OTP_REQUIRED')
  const pickup = await sendTaskOtp(task._id, 'shop_pickup', rider, capture)
  assert.equal(emails.at(-1).email, rider.email)
  await expectCode(verifyTaskOtp(task._id, input(pickup, 'shop_pickup'), rider), 'WRONG_VERIFIER')
  await verifyTaskOtp(task._id, input(pickup, 'shop_pickup'), shop)
  assert.equal((await DeliveryTask.findById(task._id)).status, 'picked_up')
  await expectCode(verifyTaskOtp(task._id, input(pickup, 'shop_pickup'), shop), 'CODE_UNAVAILABLE')
  const delivery = await sendTaskOtp(task._id, 'customer_delivery', rider, capture)
  assert.equal(emails.at(-1).email, customer.email)
  await verifyTaskOtp(task._id, input(delivery, 'customer_delivery'), rider)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'active')
  assert.equal((await reloadActor(rider)).activeDeliveryTask, undefined)
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ features: [{ properties: {
    distance: 5100, time: 660, distance_units: 'meters' } }] }), { status: 200 }))
  const quote = await quoteReturn(rental._id, customer, { collection: destination })
  await PartnerPresence.updateOne({ partnerId: rider._id }, { $set: { location: destination.location } })
  await requestReturn(rental._id, customer, { quoteToken: quote.quoteToken })
  await requestReturn(rental._id, customer, { quoteToken: quote.quoteToken })
  const returning = await DeliveryTask.findOne({ rentalId: rental._id, direction: 'return' })
  assert.equal(returning.distanceKm, 5.1)
  assert.equal(await DeliveryTask.countDocuments({ rentalId: rental._id, direction: 'return' }), 1)
  await acceptTask(returning._id, await reloadActor(rider))
  const collection = await sendTaskOtp(returning._id, 'customer_return', rider, capture)
  assert.equal(emails.at(-1).email, customer.email)
  await verifyTaskOtp(returning._id, input(collection, 'customer_return'), rider)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'return_in_transit')
  const receipt = await sendTaskOtp(returning._id, 'shop_return', rider, capture)
  assert.equal(emails.at(-1).email, rider.email)
  await expectCode(verifyTaskOtp(returning._id, input(receipt, 'shop_return'), rider), 'WRONG_VERIFIER')
  await verifyTaskOtp(returning._id, input(receipt, 'shop_return'), shop)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'returned')
  assert.equal((await DeliveryTask.findById(returning._id)).verifications.length, 2)
  assert.equal((await reloadActor(rider)).activeDeliveryTask, undefined)
})

test('expired, incorrect and failed-email challenges never advance custody', async () => {
  const task = await assign()
  await markReady(task._id, shop)
  const challenge = await sendTaskOtp(task._id, 'shop_pickup', rider, capture)
  const wrong = lastCode() === '000000' ? '111111' : '000000'
  for (let attempt = 0; attempt < 5; attempt++)
    await expectCode(verifyTaskOtp(task._id, input(challenge, 'shop_pickup', wrong), shop), 'WRONG_CODE')
  await expectCode(verifyTaskOtp(task._id, input(challenge, 'shop_pickup'), shop), 'CODE_LOCKED')
  await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'otp.expiresAt': new Date(0) } })
  await expectCode(verifyTaskOtp(task._id, input(challenge, 'shop_pickup'), shop), 'OTP_EXPIRED')
  await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'otp.sentAt': new Date(0) } })
  await expectCode(sendTaskOtp(task._id, 'shop_pickup', rider, async () => { throw new Error('Email offline') }), 'EMAIL_FAILED')
  assert.equal((await DeliveryTask.findById(task._id).select('+otp')).otp.status, 'failed')
  assert.equal((await DeliveryTask.findById(task._id)).status, 'assigned')
})

test('self return sends shop codes, enforces ownership and marks returned only after every provider receipt', async () => {
  const secondShop = await account('second-shop', 'rental_shop')
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { status: 'active', pickupVerifiedAt: new Date() },
    $push: { items: { productId: new mongoose.Types.ObjectId(), providerId: secondShop._id, title: 'Lens', decision: 'accepted' } } })
  const first = await sendSelfReturn(rental._id, customer, shop._id, capture)
  assert.equal(emails.at(-1).email, shop.email)
  const firstInput = { challengeId: first.handovers.find((h) => h.providerId === String(shop._id)).challengeId, code: lastCode() }
  await expectCode(verifySelfReturn(rental._id, await account('stranger', 'user'), firstInput), 'RENTAL_NOT_FOUND')
  const result = await verifySelfReturn(rental._id, customer, firstInput)
  assert.equal(result.returned, false)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'active')
  assert.equal((await selfReturnState(rental._id, customer)).handovers[0].status, 'verified')
  await expectCode(verifySelfReturn(rental._id, customer, firstInput), 'CODE_USED')
  await expectCode(quoteReturn(rental._id, customer, { collection: destination }), 'INVALID_RETURN')
  const second = await sendSelfReturn(rental._id, customer, secondShop._id, capture)
  assert.equal(emails.at(-1).email, secondShop.email)
  const secondInput = { challengeId: second.handovers.find((h) => h.providerId === String(secondShop._id)).challengeId, code: lastCode() }
  assert.equal((await verifySelfReturn(rental._id, customer, secondInput)).returned, true)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'returned')
})

test('self pickup rentals can choose partner return; tampered routes and competing return methods are rejected', async () => {
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { status: 'active', deliveryMethod: 'pickup',
    pickupVerifiedAt: new Date(), shipments: [] }, $unset: { deliveryWorkflowVersion: 1, deliveryDestination: 1 } })
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ features: [{ properties: {
    distance: 7200, time: 900, distance_units: 'meters' } }] }), { status: 200 }))
  const quote = await quoteReturn(rental._id, customer, { collection: destination })
  await expectCode(requestReturn(rental._id, customer, { quoteToken: quote.quoteToken + 'x' }), 'QUOTE_REQUIRED')
  await requestReturn(rental._id, customer, { quoteToken: quote.quoteToken })
  const task = await DeliveryTask.findOne({ rentalId: rental._id, direction: 'return' })
  assert.equal(task.distanceKm, 7.2)
  assert.deepEqual(task.pickup.location.coordinates, destination.location.coordinates)
  await expectCode(sendSelfReturn(rental._id, customer, shop._id, capture), 'RETURN_IN_PROGRESS')
})
