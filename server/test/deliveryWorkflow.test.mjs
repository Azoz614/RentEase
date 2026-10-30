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
import { CommissionEntry } from '../src/modules/payments/commission.model.mjs'
import { createDeliveryTasks, broadcastAvailableTasks, assignDelivery, acceptTask, listTasks, SEARCH_RADII,
  markReady, sendTaskOtp, verifyTaskOtp, progressTask, quoteReturn, requestReturn, cancelReturnCollection,
  cancelDeliveryTasks, releaseTask,
} from '../src/modules/delivery/delivery-task.service.mjs'
import { initiateVerification, verifyHandover, preparePickup } from '../src/modules/rentals/handover.service.mjs'
import { cancellationEligibility } from '../src/modules/rentals/cancellation.service.mjs'
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
    AuditLog, VerificationRate, CommissionEntry].map((model) => model.init()))
}, { timeout: 180000 })
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop() })
beforeEach(async () => {
  mock.restoreAll()
  emails = []
  await Promise.all([User, RentalRequest, Product, DeliveryTask, PartnerPresence, DeliveryLocation,
    Notification, AuditLog, VerificationRate, CommissionEntry].map((model) => model.deleteMany({})))
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
  // At the widest radius the search keeps waiting for riders until its window ends.
  assert.equal((await DeliveryTask.findById(task._id)).search.state, 'searching')
  await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'search.nextExpansionAt': new Date(0), 'search.startedAt': new Date(Date.now() - 16 * 60000) } })
  await broadcastAvailableTasks()
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
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { commissionVersion: 1, 'shipments.0.returnFee': 100 } })
  const task = await assign()
  await markReady(task._id, shop)
  await expectCode(progressTask(task._id, 'delivered', rider), 'OTP_REQUIRED')
  const pickup = await sendTaskOtp(task._id, 'shop_pickup', shop, capture)
  assert.equal(emails.at(-1).email, rider.email)
  await expectCode(verifyTaskOtp(task._id, input(pickup, 'shop_pickup'), rider), 'WRONG_VERIFIER')
  await verifyTaskOtp(task._id, input(pickup, 'shop_pickup'), shop)
  assert.equal((await DeliveryTask.findById(task._id)).status, 'picked_up')
  assert.equal((await RentalRequest.findById(rental._id)).status, 'confirmed')
  await expectCode(verifyTaskOtp(task._id, input(pickup, 'shop_pickup'), shop), 'CODE_UNAVAILABLE')
  const delivery = await sendTaskOtp(task._id, 'customer_delivery', rider, capture)
  assert.equal(emails.at(-1).email, customer.email)
  await verifyTaskOtp(task._id, input(delivery, 'customer_delivery'), rider)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'active')
  assert.equal((await reloadActor(rider)).activeDeliveryTask, undefined)
  assert.equal((await CommissionEntry.findOne({ kind: 'delivery', direction: 'delivery' })).commissionMinor, 210)
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
  const collection = await sendTaskOtp(returning._id, 'customer_return', customer, capture)
  assert.equal(emails.at(-1).email, rider.email)
  await verifyTaskOtp(returning._id, input(collection, 'customer_return'), customer)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'return_in_transit')
  const receipt = await sendTaskOtp(returning._id, 'shop_return', rider, capture)
  assert.equal(emails.at(-1).email, shop.email)
  await expectCode(verifyTaskOtp(returning._id, input(receipt, 'shop_return'), shop), 'WRONG_VERIFIER')
  await verifyTaskOtp(returning._id, input(receipt, 'shop_return'), rider)
  assert.equal((await RentalRequest.findById(rental._id)).status, 'returned')
  assert.equal((await DeliveryTask.findById(returning._id)).verifications.length, 2)
  assert.equal(await CommissionEntry.countDocuments({ rentalId: rental._id }), 2)
  assert.equal((await CommissionEntry.findOne({ kind: 'delivery', direction: 'return' })).commissionMinor, 100)
  assert.equal((await reloadActor(rider)).activeDeliveryTask, undefined)
})

test('expired, incorrect and failed-email challenges never advance custody', async () => {
  const task = await assign()
  await markReady(task._id, shop)
  const challenge = await sendTaskOtp(task._id, 'shop_pickup', shop, capture)
  const wrong = lastCode() === '000000' ? '111111' : '000000'
  for (let attempt = 0; attempt < 5; attempt++)
    await expectCode(verifyTaskOtp(task._id, input(challenge, 'shop_pickup', wrong), shop), 'WRONG_CODE')
  await expectCode(verifyTaskOtp(task._id, input(challenge, 'shop_pickup'), shop), 'CODE_LOCKED')
  await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'otp.expiresAt': new Date(0) } })
  await expectCode(verifyTaskOtp(task._id, input(challenge, 'shop_pickup'), shop), 'OTP_EXPIRED')
  await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'otp.sentAt': new Date(0) } })
  await expectCode(sendTaskOtp(task._id, 'shop_pickup', shop, async () => { throw new Error('Email offline') }), 'OTP_DELIVERY_FAILED')
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
  // No return fee was agreed at booking, so the 7.2 km trip is priced at LKR 50/km now.
  assert.equal(quote.charge, 360)
  await expectCode(requestReturn(rental._id, customer, { quoteToken: quote.quoteToken + 'x' }), 'QUOTE_REQUIRED')
  await expectCode(requestReturn(rental._id, customer, { quoteToken: quote.quoteToken }), 'DEPOSIT_INSUFFICIENT')
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { 'payment.depositHeld': 1000 } })
  await requestReturn(rental._id, customer, { quoteToken: quote.quoteToken })
  const charged = await RentalRequest.findById(rental._id)
  assert.deepEqual(charged.payment.adjustments.map((a) => [a.type, a.amount]), [['return_collection', 360]])
  const task = await DeliveryTask.findOne({ rentalId: rental._id, direction: 'return' })
  assert.equal(task.fee, 360, 'the rider is paid for the collection')
  assert.equal(task.distanceKm, 7.2)
  assert.deepEqual(task.pickup.location.coordinates, destination.location.coordinates)
  await expectCode(sendSelfReturn(rental._id, customer, shop._id, capture), 'RETURN_IN_PROGRESS')
})

test('self pickup is scoped to each shop and starts the rental only after all recipient receipts are verified', async () => {
  const secondShop = await account('pickup-second-shop', 'rental_shop')
  const second = await Product.create({ title: 'Lens', category: 'Cameras', description: 'Lens', dailyRate: 500,
    createdBy: secondShop._id, providerId: secondShop._id, photos: ['/test-lens.jpg'] })
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { deliveryMethod: 'pickup', requiresPickupPreparation: true },
    $push: { items: { productId: second._id, providerId: secondShop._id, title: second.title, decision: 'accepted' } } })
  await preparePickup({ rentalId: rental._id, actor: shop })
  const first = await initiateVerification({ rentalId: rental._id, type: 'pickup', actor: shop, sendEmail: capture })
  await expectCode(verifyHandover({ rentalId: rental._id, type: 'pickup', actor: secondShop, challengeId: first.challengeId, code: lastCode() }), 'PICKUP_NOT_READY')
  await verifyHandover({ rentalId: rental._id, type: 'pickup', actor: shop, challengeId: first.challengeId, code: lastCode() })
  let stored = await RentalRequest.findById(rental._id)
  assert.equal(stored.status, 'confirmed')
  assert.ok(stored.items[0].pickupVerifiedAt)
  assert.equal(cancellationEligibility(stored, 24).allowed, false)
  assert.equal(stored.items[1].pickupVerifiedAt, undefined)
  await expectCode(initiateVerification({ rentalId: rental._id, type: 'pickup', actor: shop, sendEmail: capture }), 'ALREADY_VERIFIED')
  await preparePickup({ rentalId: rental._id, actor: secondShop })
  const next = await initiateVerification({ rentalId: rental._id, type: 'pickup', actor: secondShop, sendEmail: capture })
  await verifyHandover({ rentalId: rental._id, type: 'pickup', actor: secondShop, challengeId: next.challengeId, code: lastCode() })
  stored = await RentalRequest.findById(rental._id)
  assert.equal(stored.status, 'active')
  assert.ok(stored.items.every((i) => i.pickupVerifiedAt))
  assert.equal(stored.statusHistory.filter((e) => e.action === 'pickup.verified').length, 2)
})

test('private OTP notifications match email recipients and never appear in another task participant inbox', async () => {
  const task = await assign()
  await markReady(task._id, shop)
  await expectCode(sendTaskOtp(task._id, 'shop_pickup', rider, capture), 'WRONG_VERIFIER')
  const pickup = await sendTaskOtp(task._id, 'shop_pickup', shop, capture)
  const code = lastCode()
  const recipient = await listTasks(rider)
  assert.ok(recipient.tasks[0].otpNotice.body.includes(code))
  assert.equal(recipient.tasks[0].canSendOtp, false)
  for (const actor of [shop, customer, otherRider])
    assert.equal(JSON.stringify(await listTasks(actor)).includes(code), false)
  await verifyTaskOtp(task._id, input(pickup, 'shop_pickup'), shop)
  assert.equal(await Notification.countDocuments({ type: 'handover_otp' }), 0)
})

test('notification failure after delivery email invalidates the code without advancing custody', async () => {
  const task = await assign()
  await markReady(task._id, shop)
  mock.method(Notification, 'updateOne', async () => { throw new Error('Inbox unavailable') })
  await expectCode(sendTaskOtp(task._id, 'shop_pickup', shop, capture), 'OTP_DELIVERY_FAILED')
  const saved = await DeliveryTask.findById(task._id).select('+otp')
  assert.equal(saved.otp.status, 'failed')
  assert.equal(saved.otp.hash, undefined)
  assert.equal(saved.status, 'assigned')
  assert.equal((await RentalRequest.findById(rental._id)).status, 'confirmed')
})

test('an unaccepted collection can switch to self return, releasing the charge; a repeat request is charged again', async () => {
  await RentalRequest.updateOne({ _id: rental._id }, { $set: { status: 'active', deliveryMethod: 'pickup',
    pickupVerifiedAt: new Date(), shipments: [], 'payment.depositHeld': 1000 }, $unset: { deliveryWorkflowVersion: 1, deliveryDestination: 1 } })
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ features: [{ properties: {
    distance: 7200, time: 900, distance_units: 'meters' } }] }), { status: 200 }))
  await requestReturn(rental._id, customer, { quoteToken: (await quoteReturn(rental._id, customer, { collection: destination })).quoteToken })
  assert.equal((await RentalRequest.findById(rental._id)).shipments[0].returnFeePrepaid, false)
  await expectCode(cancelReturnCollection(rental._id, rider), 'CUSTOMER_REQUIRED')
  await cancelReturnCollection(rental._id, customer)
  const reset = await RentalRequest.findById(rental._id)
  assert.equal(reset.payment.adjustments.length, 0, 'the collection charge is released')
  assert.equal(reset.returnMethod, undefined); assert.equal(reset.deliveryReturnRequestedAt, undefined)
  assert.equal(await DeliveryTask.countDocuments({ rentalId: rental._id, direction: 'return' }), 0)
  assert.equal((await selfReturnState(rental._id, customer)).handovers.length, 1, 'self return is open again')
  // The route fee charged last time was not paid at booking, so a new request charges it again.
  const again = await quoteReturn(rental._id, customer, { collection: destination })
  assert.equal(again.charge, 360)
  await presence(rider, destination.location)
  await requestReturn(rental._id, customer, { quoteToken: again.quoteToken })
  const task = await DeliveryTask.findOne({ rentalId: rental._id, direction: 'return' })
  assert.equal(task.status, 'available'); assert.equal(task.fee, 360)
  await acceptTask(task._id, rider)
  await expectCode(cancelReturnCollection(rental._id, customer), 'RIDER_ASSIGNED')
})

test('releasing a booking frees the rider and invalidates any pending handover code', async () => {
  const task = await assign()
  assert.ok((await reloadActor(rider)).activeDeliveryTask)
  await markReady(task._id, shop)
  const sent = await sendTaskOtp(task._id, 'shop_pickup', shop, capture)
  assert.equal(await Notification.countDocuments({ handoverChallengeId: sent.challengeId }), 1)
  await mongoose.connection.transaction((session) => cancelDeliveryTasks(rental._id, session, 'disputed'))
  assert.equal((await reloadActor(rider)).activeDeliveryTask, undefined)
  assert.equal((await DeliveryTask.findById(task._id)).status, 'cancelled')
  assert.equal(await Notification.countDocuments({ handoverChallengeId: sent.challengeId }), 0)
  assert.match((await Notification.findOne({ userId: rider._id, title: 'Trip cancelled' })).body, /under review/)
})

test('a rider who comes online after the widest radius still receives the request', async () => {
  await assignDelivery(rental._id, customer)
  const task = await DeliveryTask.findOne({ rentalId: rental._id })
  for (let round = 0; round < SEARCH_RADII.length + 2; round++) {
    await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'search.nextExpansionAt': new Date(0) } })
    await broadcastAvailableTasks()
  }
  await presence(rider)
  await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'search.nextExpansionAt': new Date(0) } })
  await broadcastAvailableTasks()
  const offered = await DeliveryTask.findById(task._id)
  assert.equal(offered.search.state, 'searching')
  assert.deepEqual(offered.offeredPartnerIds.map(String), [String(rider._id)])
  await acceptTask(task._id, rider)
})

test('a trip stuck before collection can be released by the rider or the shop, freeing the rider', async () => {
  const task = await assign()
  await markReady(task._id, shop)
  const sent = await sendTaskOtp(task._id, 'shop_pickup', shop, capture)
  await expectCode(releaseTask(task._id, customer), 'RELEASE_FORBIDDEN')
  await expectCode(releaseTask(task._id, otherRider), 'TASK_NOT_FOUND')
  await releaseTask(task._id, await reloadActor(rider))
  const reopened = await DeliveryTask.findById(task._id)
  assert.equal(reopened.status, 'available'); assert.equal(reopened.assignedPartner, null)
  assert.equal(reopened.search.state, 'searching')
  assert.deepEqual(reopened.declinedPartnerIds.map(String), [String(rider._id)], 'the rider is not offered it again')
  assert.ok(reopened.readyAt, 'the shop does not need to prepare the items again')
  assert.equal((await reloadActor(rider)).activeDeliveryTask, undefined)
  assert.equal(await Notification.countDocuments({ handoverChallengeId: sent.challengeId }), 0)
  const booking = await RentalRequest.findById(rental._id)
  assert.equal(booking.items[0].assignedPartner, undefined); assert.equal(booking.items[0].deliveryStatus, 'assigned')
  // Another rider takes it; the shop can release that rider too, but not once the items are collected.
  await presence(otherRider)
  await DeliveryTask.updateOne({ _id: task._id }, { $set: { 'search.nextExpansionAt': new Date(0) } })
  await broadcastAvailableTasks()
  await acceptTask(task._id, otherRider)
  const code = await sendTaskOtp(task._id, 'shop_pickup', shop, capture)
  await verifyTaskOtp(task._id, input(code, 'shop_pickup'), shop)
  await expectCode(releaseTask(task._id, shop), 'IN_CUSTODY')
})
