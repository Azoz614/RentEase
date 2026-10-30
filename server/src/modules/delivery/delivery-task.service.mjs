import mongoose from 'mongoose'
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { DeliveryTask } from './delivery-task.model.mjs'
import { PartnerPresence } from './partner-presence.model.mjs'
import { DeliveryLocation } from './delivery-location.model.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { Product } from '../products/product.model.mjs'
import { User } from '../users/user.model.mjs'
import { pointsForItems } from '../loyalty/loyalty.service.mjs'
import { Notification } from '../notifications/notification.model.mjs'
import { publishHandoverOtp, removeHandoverOtp } from '../notifications/handover-notifications.service.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'
import { point } from '../maps/location.service.mjs'
import {
  drivingRoute,
  fee as routeFee,
  DELIVERY_BASE_FEE,
  DELIVERY_RATE_PER_KM,
} from './delivery-quote.service.mjs'
import { identityRate } from '../identity/identity-security.service.mjs'
import { sendRegistrationOtp } from '../../config/mailer.js'
import { requireTransactions } from '../../services/mongo-transactions.mjs'
import { createHttpError as fail } from '../../utils/http-error.mjs'

export const SEARCH_RADIUS_METERS = 10000
// Search state lives in MongoDB so restarts and multiple API processes resume the same rounds.
export const SEARCH_RADII = [2000, 5000, 10000, 25000, 50000, 100000, 20040000]
const searchTimeout = () => Math.max(5, Math.min(300, Number(process.env.DELIVERY_SEARCH_TIMEOUT_SECONDS) || 30)) * 1000
// After the widest radius the search keeps checking for riders who come online, until this window ends.
const searchWindow = () => Math.max(1, Math.min(120, Number(process.env.DELIVERY_SEARCH_WINDOW_MINUTES) || 15)) * 60000
const TTL = 5 * 60000,
  COOLDOWN = 60000,
  MAX_ATTEMPTS = 5
const terminal = ['delivered', 'returned', 'cancelled']
const same = (a, b) => String(a) === String(b)
const owned = (task, actor) =>
  actor.role === 'admin' || (actor.role === 'rental_shop' && same(task.providerId, actor._id))
const assigned = (task, actor) =>
  actor.role === 'delivery_partner' && same(task.assignedPartner, actor._id)
const hash = (value) => {
  const key = process.env.RENTAL_OTP_SECRET || process.env.OTP_SECRET || process.env.SESSION_SECRET
  if (!key) throw fail(503, 'OTP_NOT_CONFIGURED', 'Email verification is not configured.')
  return createHmac('sha256', key).update(value).digest('hex')
}
const equal = (a, b) => {
  const x = Buffer.from(a || '', 'hex'),
    y = Buffer.from(b || '', 'hex')
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y)
}
const emailHash = (email) => hash('delivery-email:' + email.toLowerCase())
const codeHash = (task, otp, code) =>
  hash([task._id, task.assignedPartner, otp.kind, otp.id, otp.recipientId, code].join(':'))
const mask = (email) => {
  const [name, domain] = email.split('@')
  return name.slice(0, 1) + '***@' + domain
}
export function validId(id) {
  if (!mongoose.isValidObjectId(id))
    throw fail(400, 'INVALID_TASK', 'Choose a valid delivery task.')
  return id
}
const history = (actor, status, action) => ({ status, action, by: actor._id, at: new Date() })

export async function createDeliveryTasks(
  rental,
  session,
  direction = 'delivery',
  routes = new Map(),
) {
  if (direction === 'delivery' && rental.deliveryMethod !== 'partner') return
  const collection = rental.returnDestination?.location ? rental.returnDestination : rental.deliveryDestination
  if (!(direction === 'return' ? collection?.location : rental.deliveryDestination?.location))
    throw fail(
      409,
      'LOCATION_REQUIRED',
      'This booking needs a confirmed delivery location before dispatch.',
    )
  const providers = [
    ...new Set(
      rental.items.filter((i) => i.decision === 'accepted').map((i) => String(i.providerId)),
    ),
  ]
  for (const providerId of providers) {
    const shipment = rental.shipments.find((s) => same(s.providerId, providerId))
    if (!shipment?.origin)
      throw fail(409, 'LOCATION_REQUIRED', 'The booking has no saved shop pickup location.')
    const items = rental.items.filter(
      (i) => same(i.providerId, providerId) && i.decision === 'accepted',
    )
    const returning = direction === 'return',
      route = routes.get(providerId)
    await DeliveryTask.updateOne(
      { rentalId: rental._id, providerId, direction },
      {
        $setOnInsert: {
          rentalId: rental._id,
          customerId: rental.customerId,
          providerId,
          direction,
          productIds: items.map((i) => i.productId),
          titles: items.map((i) => i.title),
          pickup: returning
            ? collection
            : { address: shipment.shopAddress, location: shipment.origin },
          destination: returning
            ? { address: shipment.shopAddress, location: shipment.origin }
            : rental.deliveryDestination,
          distanceKm: returning
            ? (route?.distanceKm ?? shipment.returnDistanceKm)
            : shipment.distanceKm,
          etaMinutes: returning
            ? (route?.etaMinutes ?? shipment.returnEtaMinutes)
            : shipment.etaMinutes,
          fee: returning ? shipment.returnFee || 0 : shipment.fee,
          status: 'available',
          search: {
            state: returning ? 'searching' : 'waiting',
            radiusMeters: SEARCH_RADII[0], round: 0,
            ...(returning ? { startedAt: new Date(), nextExpansionAt: new Date() } : {}),
          },
          history: [{ status: 'available', action: 'delivery.offered', at: new Date() }],
        },
      },
      { session, upsert: true, runValidators: true },
    )
  }
  rental.deliveryWorkflowVersion = 2
}

let broadcasting = false
export async function broadcastAvailableTasks() {
  if (broadcasting) return
  broadcasting = true
  try {
    const legacyJobs = await RentalRequest.find({
      deliveryMethod: 'partner',
      deliveryWorkflowVersion: { $ne: 2 },
      status: { $in: ['confirmed', 'active', 'returned'] },
    })
      .select('items')
      .lean()
    const legacyBusy = legacyJobs.flatMap((r) =>
      r.items
        .filter((i) => i.assignedPartner && !['delivered', 'returned'].includes(i.deliveryStatus))
        .map((i) => i.assignedPartner),
    )
    const now = new Date()
    // Existing return tasks were created only by an explicit collection request.
    await DeliveryTask.updateMany({ direction: 'return', status: 'available', 'search.state': { $exists: false } },
      { $set: { search: { state: 'searching', radiusMeters: SEARCH_RADII[0], round: 0,
        startedAt: now, nextExpansionAt: now } } })
    for await (const task of DeliveryTask.find({ status: 'available', 'search.state': 'searching',
      'search.nextExpansionAt': { $lte: now } }).lean().cursor()) {
      const rental = await RentalRequest.findById(task.rentalId).select('status returnMethod deliveryReturnRequestedAt').lean()
      if (!rental || (task.direction === 'delivery' ? rental.status !== 'confirmed'
        : !['active', 'return_in_transit'].includes(rental.status) ||
          (rental.returnMethod ? rental.returnMethod !== 'partner' : !rental.deliveryReturnRequestedAt))) continue
      const round = task.search.round || 0
      const widest = round >= SEARCH_RADII.length
      const windowOver = now - new Date(task.search.startedAt || 0) >= searchWindow()
      if (widest && windowOver) {
        const ended = await DeliveryTask.updateOne({ _id: task._id, status: 'available',
          'search.state': 'searching', 'search.round': round },
          { $set: { 'search.state': 'exhausted', 'search.exhaustedAt': now }, $inc: { __v: 1 } })
        if (ended.modifiedCount) {
          // Tell the customer and shop the search ended, so they can retry; drop the stale offers.
          await clearOffers([task._id])
          await Notification.insertMany([task.customerId, task.providerId].filter(Boolean).map((userId) => ({
            userId, requestId: task.rentalId, type: 'delivery', link: 'requests', title: 'No rider available yet',
            body: task.direction === 'return'
              ? 'No nearby rider accepted the return collection. Search again from My rentals, or return the items yourself.'
              : 'No nearby rider accepted this delivery. Search again from the booking when you are ready.',
          })))
        }
        continue
      }
      const radius = SEARCH_RADII[Math.min(round, SEARCH_RADII.length - 1)]
      const claimed = await DeliveryTask.updateOne({ _id: task._id, status: 'available',
        'search.state': 'searching', 'search.round': round, 'search.nextExpansionAt': { $lte: now } },
        { $set: { 'search.radiusMeters': radius,
          'search.nextExpansionAt': new Date(now.getTime() + searchTimeout()) },
          $inc: { 'search.round': widest ? 0 : 1, __v: 1 } })
      if (!claimed.modifiedCount) continue
      const near = await PartnerPresence.find({
        online: true,
        expiresAt: { $gt: new Date() },
        location: {
          $near: { $geometry: point(task.pickup.location), $maxDistance: radius },
        },
        partnerId: { $nin: task.declinedPartnerIds },
      })
        .select('partnerId')
        .lean()
      const partners = await User.find({
        _id: { $in: near.map((p) => p.partnerId), $nin: legacyBusy },
        role: 'delivery_partner',
        active: true,
        activeDeliveryTask: null,
      })
        .select('_id')
        .lean()
      const fresh = partners.filter((p) => !task.offeredPartnerIds.some((id) => same(id, p._id)))
      if (!fresh.length) continue
      await requireTransactions()
      await mongoose.connection.transaction(async (session) => {
        const offered = await DeliveryTask.updateOne(
          { _id: task._id, status: 'available', 'search.state': 'searching' },
          { $addToSet: { offeredPartnerIds: { $each: fresh.map((p) => p._id) } } }, { session },
        )
        if (!offered.matchedCount) return
        await Notification.bulkWrite(
        fresh.map((p) => ({
          updateOne: {
            filter: { userId: p._id, deliveryTaskId: task._id, type: 'delivery_offer' },
            update: {
              $setOnInsert: {
                requestId: task.rentalId,
                title:
                  task.direction === 'return'
                    ? 'Nearby return collection'
                    : 'Nearby rental delivery',
                body: 'A nearby pickup is available. First successful acceptance gets the task.',
                link: 'requests',
              },
            },
            upsert: true,
          },
        })), { session },
        )
      })
    }
  } catch (error) {
    console.error('Delivery offer refresh deferred:', error.name)
  } finally {
    broadcasting = false
  }
}

// Offers are upserted once per partner and task; clearing them lets a restarted search
// notify the same riders again, and stops stale offers lingering in partner inboxes.
async function clearOffers(taskIds, session) {
  if (taskIds.length)
    await Notification.deleteMany({ deliveryTaskId: { $in: taskIds }, type: 'delivery_offer' }, { session })
}

export function startDeliveryDispatch() {
  const timer = setInterval(() => broadcastAvailableTasks(), 3000)
  timer.unref()
  broadcastAvailableTasks()
  return () => clearInterval(timer)
}

export async function assignDelivery(rentalId, actor) {
  if (actor.role !== 'user') throw fail(403, 'CUSTOMER_REQUIRED', 'Only the booking customer can assign a partner.')
  await identityRate(actor._id, 'delivery-dispatch', 30)
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const rental = await RentalRequest.findOne({ _id: validId(rentalId), customerId: actor._id }).session(session)
    if (!rental || rental.status !== 'confirmed' || rental.deliveryMethod !== 'partner' ||
      !rental.items.every((i) => i.decision === 'accepted'))
      throw fail(409, 'APPROVAL_REQUIRED', 'The shop must approve every rental item before you assign a partner.')
    // A rider who accepts is locked to the trip, so never dispatch an unpaid booking.
    if (!['authorized', 'paid'].includes(rental.payment?.status))
      throw fail(409, 'PAYMENT_REQUIRED', 'Pay for this booking before assigning a delivery partner.')
    await createDeliveryTasks(rental, session)
    const now = new Date()
    const restarted = await DeliveryTask.find({ rentalId, direction: 'delivery', status: 'available',
      $or: [{ 'search.state': { $in: ['waiting', 'exhausted'] } }, { 'search.state': { $exists: false } }] })
      .select('_id').session(session).lean()
    await DeliveryTask.updateMany({ _id: { $in: restarted.map((task) => task._id) } },
      { $set: { search: { state: 'searching', radiusMeters: SEARCH_RADII[0], round: 0,
        startedAt: now, nextExpansionAt: now }, offeredPartnerIds: [], declinedPartnerIds: [] }, $inc: { __v: 1 } }, { session })
    await clearOffers(restarted.map((task) => task._id), session)
    rental.deliveryAssignmentRequestedAt ||= now
    await rental.save({ session })
  })
  await broadcastAvailableTasks()
  return { message: 'Finding nearby available riders. We will expand the search automatically.' }
}

export async function setPresence(actor, input) {
  if (actor.role !== 'delivery_partner')
    throw fail(403, 'PARTNER_REQUIRED', 'Delivery partner access is required.')
  if (typeof input.online !== 'boolean')
    throw fail(400, 'INVALID_PRESENCE', 'Choose online or offline.')
  if (!input.online) {
    await PartnerPresence.deleteOne({ partnerId: actor._id })
    await DeliveryLocation.deleteMany({ partnerId: actor._id })
    await DeliveryTask.updateMany({ assignedPartner: actor._id, sharing: true }, { $set: { sharing: false } })
    return { online: false }
  }
  await identityRate(actor._id, 'partner-presence', 1500)
  const accuracy = Number(input.accuracy)
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 5000)
    throw fail(400, 'LOCATION_REQUIRED', 'Share a sufficiently accurate current GPS location.')
  const now = new Date()
  await PartnerPresence.findOneAndUpdate(
    { partnerId: actor._id },
    {
      $set: {
        online: true,
        location: point(input.location),
        accuracy,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 90000),
      },
    },
    { upsert: true, runValidators: true },
  )
  const partner = await User.findById(actor._id).select('activeDeliveryTask').lean()
  if (partner?.activeDeliveryTask) {
    const trip = await DeliveryTask.findOne({ _id: partner.activeDeliveryTask, assignedPartner: actor._id,
      status: { $nin: terminal } }).lean()
    if (trip) {
      const rental = await RentalRequest.findOne({ _id: trip.rentalId,
        status: { $in: ['confirmed', 'active', 'return_in_transit'] } }).select('status items').lean()
      if (rental && trip.productIds.every((id) => rental.items.some((i) => same(i.productId, id) && same(i.assignedPartner, actor._id)))) {
        const expiresAt = new Date(now.getTime() + 90000)
        await DeliveryLocation.bulkWrite(trip.productIds.map((productId) => ({ updateOne: {
          filter: { rentalId: trip.rentalId, productId }, update: { $set: { rentalId: trip.rentalId, productId,
            partnerId: actor._id, location: point(input.location), accuracy, updatedAt: now, expiresAt } }, upsert: true,
        } })))
        const active = await RentalRequest.exists({ _id: rental._id, status: rental.status,
          items: { $elemMatch: { productId: trip.productIds[0], assignedPartner: actor._id, deliveryStatus: trip.status } } })
        const shared = active && await DeliveryTask.updateOne({ _id: trip._id, status: trip.status, assignedPartner: actor._id },
          { $set: { sharing: true, locationUpdatedAt: now } })
        if (!shared?.matchedCount) await DeliveryLocation.deleteMany({ rentalId: trip.rentalId, partnerId: actor._id, updatedAt: now })
      }
    }
  }
  await broadcastAvailableTasks()
  return { online: true, expiresAt: new Date(now.getTime() + 90000) }
}

export async function getTask(id, actor, session) {
  const query = DeliveryTask.findById(validId(id)).select('+otp')
  if (session) query.session(session)
  const task = await query
  if (
    !task ||
    !(
      owned(task, actor) ||
      assigned(task, actor) ||
      (actor.role === 'user' && same(task.customerId, actor._id)) ||
      (actor.role === 'delivery_partner' &&
        task.status === 'available' &&
        task.offeredPartnerIds.some((id) => same(id, actor._id)))
    )
  )
    throw fail(404, 'TASK_NOT_FOUND', 'Delivery task not found for this account.')
  return task
}

export async function listTasks(actor) {
  await broadcastAvailableTasks()
  let tasks,
    presence,
    legacyBusy = false
  if (actor.role === 'delivery_partner') {
    legacyBusy = Boolean(
      await RentalRequest.exists({
        deliveryMethod: 'partner',
        deliveryWorkflowVersion: { $ne: 2 },
        status: { $in: ['confirmed', 'active', 'returned'] },
        items: {
          $elemMatch: {
            assignedPartner: actor._id,
            deliveryStatus: { $nin: ['delivered', 'returned'] },
          },
        },
      }),
    )
    presence = await PartnerPresence.findOne({
      partnerId: actor._id,
      online: true,
      expiresAt: { $gt: new Date() },
    }).lean()
    tasks = await DeliveryTask.find({ assignedPartner: actor._id, status: { $ne: 'cancelled' } })
      .select('+otp')
      .sort({ updatedAt: -1 })
      .limit(100)
    if (presence && !actor.activeDeliveryTask && !legacyBusy) {
      const offers = await DeliveryTask.find({
        status: 'available',
        offeredPartnerIds: actor._id,
        declinedPartnerIds: { $ne: actor._id },
        'search.state': 'searching',
      })
        .select('+otp')
        .limit(50)
      tasks.push(...offers)
    }
  } else {
    const scope =
      actor.role === 'admin'
        ? {}
        : actor.role === 'rental_shop'
          ? { providerId: actor._id }
          : { customerId: actor._id }
    tasks = await DeliveryTask.find(scope).select('+otp').sort({ updatedAt: -1 }).limit(150)
  }
  const rentals = await RentalRequest.find({ _id: { $in: tasks.map((t) => t.rentalId) } })
    .select('status payment.status readyForPickupAt deliveryReturnRequestedAt returnMethod')
    .lean()
  const people = await User.find({
    _id: { $in: tasks.flatMap((t) => [t.assignedPartner, t.providerId, t.customerId,
      ...t.verifications.flatMap((v) => [v.initiatedBy, v.recipientId, v.verifiedBy])]).filter(Boolean) },
  })
    .select('username shopName phone')
    .lean()
  const privateCodes = await Notification.find({ userId: actor._id, type: 'handover_otp',
    deliveryTaskId: { $in: tasks.map((t) => t._id) }, expiresAt: { $gt: new Date() } })
    .select('deliveryTaskId title body expiresAt').lean()
  const trackingScopes = tasks
    .filter((task) => task.assignedPartner && !terminal.includes(task.status))
    .map((task) => ({
      rentalId: task.rentalId,
      productId: { $in: task.productIds },
      partnerId: task.assignedPartner,
    }))
  const positions = trackingScopes.length
    ? await DeliveryLocation.find({
        $or: trackingScopes,
        expiresAt: { $gt: new Date() },
      })
        .select('rentalId productId partnerId location accuracy updatedAt expiresAt')
        .lean()
    : []
  return {
    online: Boolean(presence),
    busy: Boolean(actor.activeDeliveryTask || legacyBusy),
    radiusKm: SEARCH_RADIUS_METERS / 1000,
    tasks: tasks
      .filter((t) =>
        rentals.some(
          (r) => same(r._id, t.rentalId) && !['cancelled', 'disputed'].includes(r.status),
        ),
      )
      .map((t) => {
        const rental = rentals.find((r) => same(r._id, t.rentalId)),
          p = people.find((p) => same(p._id, t.assignedPartner))
        const provider = people.find((p) => same(p._id, t.providerId))
        const customer = people.find((p) => same(p._id, t.customerId))
        const kind = ['shop_pickup', 'customer_delivery', 'customer_return', 'shop_return'].find((kind) => stageFor(t, kind))
        const sender = Boolean(kind && canHandover(t, kind, actor))
        const live =
          !terminal.includes(t.status) &&
          positions.find(
            (position) =>
              same(position.rentalId, t.rentalId) &&
              same(position.partnerId, t.assignedPartner) &&
              t.productIds.some((id) => same(id, position.productId)),
          )
        return {
          id: t._id,
          rentalId: t.rentalId,
          direction: t.direction,
          titles: t.titles,
          status: t.status,
          search: t.search,
          pickup: t.pickup,
          destination: t.destination,
          distanceKm: t.distanceKm ?? null,
          etaMinutes: t.etaMinutes ?? null,
          fee: t.fee,
          rentalStatus: rental.status,
          paid: ['authorized', 'paid'].includes(rental.payment?.status),
          ready: Boolean(t.readyAt || rental.readyForPickupAt),
          returnRequested: Boolean(rental.deliveryReturnRequestedAt),
          returnMethod: rental.returnMethod || null,
          partner: p ? { id: p._id, name: p.username, phone: p.phone || '' } : null,
          live: live
            ? {
                location: live.location,
                accuracy: live.accuracy,
                updatedAt: live.updatedAt,
                expiresAt: live.expiresAt,
              }
            : null,
          shop: provider?.shopName || provider?.username || 'Rental shop',
          contacts: t.assignedPartner && (owned(t, actor) || assigned(t, actor) || same(t.customerId, actor._id))
            ? { shop: provider ? { name: provider.shopName || provider.username, phone: provider.phone } : null,
                customer: customer ? { name: customer.username, phone: customer.phone } : null } : null,
          handoverKind: kind || null,
          canSendOtp: sender,
          canVerifyOtp: sender && (!t.otp || same(t.otp.initiatedBy, actor._id)),
          otpNotice: privateCodes.find((n) => same(n.deliveryTaskId, t._id)) || null,
          verifications: t.verifications.map((v) => ({ kind: v.kind, at: v.at,
            ...(owned(t, actor) ? { senderId: v.initiatedBy, recipientId: v.recipientId, verifiedBy: v.verifiedBy,
              senderName: people.find((p) => same(p._id, v.initiatedBy))?.username,
              recipientName: people.find((p) => same(p._id, v.recipientId))?.username,
              verifierName: people.find((p) => same(p._id, v.verifiedBy))?.username } : {}) })),
          canManage: owned(t, actor),
          canOperate: assigned(t, actor),
          history: t.history,
          challenge:
            sender && t.otp?.status === 'sent'
              ? {
                  id: t.otp.id,
                  kind: t.otp.kind,
                  expiresAt: t.otp.expiresAt,
                  resendAt: new Date(t.otp.sentAt.getTime() + COOLDOWN),
                  maskedEmail: t.otp.maskedEmail,
                }
              : null,
        }
      }),
  }
}

// Notifies everyone involved in a trip except the person who just acted.
async function notifyTask(task, message, session, actor) {
  for (const id of new Set(
    [task.customerId, task.providerId, task.assignedPartner].filter(Boolean).map(String)
      .filter((id) => !actor || id !== String(actor._id)),
  ))
    await Notification.create(
      [
        {
          userId: id,
          requestId: task.rentalId,
          title: 'Delivery update',
          body: message,
          type: 'delivery',
          link: 'requests',
        },
      ],
      { session },
    )
}

export async function acceptTask(id, actor) {
  if (actor.role !== 'delivery_partner')
    throw fail(403, 'PARTNER_REQUIRED', 'Delivery partner access is required.')
  const task = await getTask(id, actor)
  const near = await PartnerPresence.findOne({
    partnerId: actor._id,
    online: true,
    expiresAt: { $gt: new Date() },
    location: {
      $near: { $geometry: point(task.pickup.location), $maxDistance: task.search?.radiusMeters || SEARCH_RADIUS_METERS },
    },
  }).lean()
  if (!near)
    throw fail(
      409,
      'LOCATION_REQUIRED',
      'Go online and share a current location within the pickup radius.',
    )
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const rental = await RentalRequest.findById(task.rentalId).session(session)
    if (!rental || !['confirmed', 'active', 'return_in_transit'].includes(rental.status))
      throw fail(409, 'RENTAL_CHANGED', 'This rental is no longer ready for delivery.')
    const present = await PartnerPresence.updateOne({ _id: near._id, partnerId: actor._id,
      online: true, updatedAt: near.updatedAt, expiresAt: { $gt: new Date() } },
      { $inc: { __v: 1 } }, { session })
    if (!present.matchedCount) throw fail(409, 'PRESENCE_CHANGED', 'Your location or online status changed. Refresh and accept again.')
    const legacyTrip = await RentalRequest.exists({
      deliveryMethod: 'partner',
      deliveryWorkflowVersion: { $ne: 2 },
      status: { $in: ['confirmed', 'active', 'returned'] },
      items: {
        $elemMatch: {
          assignedPartner: actor._id,
          deliveryStatus: { $nin: ['delivered', 'returned'] },
        },
      },
    }).session(session)
    if (legacyTrip)
      throw fail(
        409,
        'PARTNER_BUSY',
        'Finish your existing delivery assignment before accepting another trip.',
      )
    const partner = await User.findOneAndUpdate(
      { _id: actor._id, active: true, role: 'delivery_partner', activeDeliveryTask: null },
      { $set: { activeDeliveryTask: task._id }, $inc: { __v: 1 } },
      { session },
    )
    if (!partner)
      throw fail(409, 'PARTNER_BUSY', 'Finish your assigned trip before accepting another.')
    const status = task.direction === 'delivery' ? 'assigned' : 'return_pickup'
    const accepted = await DeliveryTask.findOneAndUpdate(
      {
        _id: task._id,
        status: 'available',
        assignedPartner: null,
        offeredPartnerIds: actor._id,
        declinedPartnerIds: { $ne: actor._id },
        'search.state': 'searching',
      },
      {
        $set: { assignedPartner: actor._id, acceptedAt: new Date(), status, sharing: true, locationUpdatedAt: near.updatedAt, 'search.state': 'assigned' },
        $push: { history: history(actor, status, 'delivery.accepted') },
        $inc: { __v: 1 },
      },
      { session, returnDocument: 'after' },
    )
    if (!accepted)
      throw fail(
        409,
        'ALREADY_ASSIGNED',
        'This request is no longer available. Another rider may have accepted it, or the search ended.',
      )
    for (const item of rental.items.filter((i) =>
      accepted.productIds.some((id) => same(id, i.productId)),
    )) {
      item.assignedPartner = actor._id
      item.deliveryStatus = status
    }
    rental.statusHistory.push({
      status: rental.status,
      by: actor._id,
      action: 'delivery.accepted',
      note: 'A nearby partner accepted the shop shipment.',
    })
    await rental.save({ session })
    await DeliveryLocation.bulkWrite(accepted.productIds.map((productId) => ({ updateOne: {
      filter: { rentalId: rental._id, productId }, update: { $set: { rentalId: rental._id, productId,
        partnerId: actor._id, location: point(near.location), accuracy: near.accuracy,
        updatedAt: near.updatedAt, expiresAt: near.expiresAt } }, upsert: true,
    } })), { session })
    await Notification.deleteMany({ deliveryTaskId: task._id, type: 'delivery_offer' }, { session })
    await notifyTask(
      accepted,
      'A delivery partner accepted your ' +
        accepted.direction +
        ' task. Contact details are available in delivery tracking.',
      session,
      actor,
    )
  })
  return { message: 'Task accepted. It has been removed from other partners’ available requests.' }
}

export async function declineTask(id, actor) {
  if (actor.role !== 'delivery_partner')
    throw fail(403, 'PARTNER_REQUIRED', 'Delivery partner access is required.')
  const result = await DeliveryTask.updateOne(
    { _id: validId(id), status: 'available', offeredPartnerIds: actor._id },
    { $addToSet: { declinedPartnerIds: actor._id } },
  )
  if (!result.matchedCount) throw fail(409, 'TASK_CHANGED', 'This request is no longer available.')
  await Notification.deleteOne({ userId: actor._id, deliveryTaskId: id, type: 'delivery_offer' })
  return { message: 'Request declined. Other nearby partners can still accept it.' }
}

export async function retryReturnSearch(id, actor) {
  if (actor.role !== 'user') throw fail(403, 'CUSTOMER_REQUIRED', 'Only the customer can restart collection.')
  await identityRate(actor._id, 'delivery-dispatch', 30)
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const task = await getTask(id, actor, session)
    const rental = await activeRental(task, session)
    if (task.direction !== 'return' || task.status !== 'available' || task.search?.state !== 'exhausted' || !['active', 'return_in_transit'].includes(rental.status))
      throw fail(409, 'SEARCH_CHANGED', 'This collection is already searching or assigned.')
    task.search = { state: 'searching', radiusMeters: SEARCH_RADII[0], round: 0,
      startedAt: new Date(), nextExpansionAt: new Date() }
    task.offeredPartnerIds = []
    task.declinedPartnerIds = []
    await task.save({ session })
    await clearOffers([task._id], session)
    rental.statusHistory.push({ status: rental.status, by: actor._id, action: 'return.search_restarted' })
    await rental.save({ session })
  })
  await broadcastAvailableTasks()
  return { message: 'Finding available return riders again.' }
}

export async function quoteReturn(rentalId, actor, input = {}) {
  if (actor.role !== 'user')
    throw fail(403, 'CUSTOMER_REQUIRED', 'Only the booking customer can request collection.')
  await identityRate(actor._id, 'return-quote', 30)
  const rental = await RentalRequest.findOne({ _id: validId(rentalId), customerId: actor._id }).lean()
  if (!rental || rental.status !== 'active' || !rental.pickupVerifiedAt || rental.returnMethod === 'pickup')
    throw fail(409, 'INVALID_RETURN', 'Only an active rental without a self return in progress can request collection.')
  const collection = input.collection || rental.deliveryDestination
  if (!collection?.location || typeof collection.address !== 'string' || collection.address.trim().length < 5 || collection.address.length > 600)
    throw fail(400, 'LOCATION_REQUIRED', 'Confirm a complete collection address and map pin.')
  const location = { address: collection.address.trim(), location: point(collection.location) }
  const ids = [...new Set(rental.items.filter((i) => i.decision === 'accepted').map((i) => String(i.providerId)))]
  const providers = await User.find({ _id: { $in: ids }, active: true,
    $or: [{ role: 'admin' }, { role: 'rental_shop', shopStatus: 'approved' }] }).select('shopLocation shopAddress shopName username').lean()
  if (providers.length !== ids.length) throw fail(409, 'PROVIDER_UNAVAILABLE', 'A responsible shop is unavailable. Contact the shop before returning.')
  const shipments = []
  for (const provider of providers) {
    const saved = rental.shipments.find((s) => same(s.providerId, provider._id))
    const origin = saved?.origin || provider.shopLocation
    if (!origin) throw fail(409, 'LOCATION_REQUIRED', 'The shop must confirm its return location before collection.')
    const route = await drivingRoute(location.location, origin)
    // A return fee agreed in the original booking stands. Otherwise the trip is priced by route
    // at the delivery rate and charged now, so the rider is always paid for the collection.
    // Older bookings have no flag; a fee saved with the booking quote was paid up front.
    const prepaid = saved?.returnFeePrepaid !== false && Number(saved?.returnFee) > 0
    shipments.push({ providerId: String(provider._id), origin, shopAddress: saved?.shopAddress || provider.shopAddress,
      shopName: saved?.shopName || provider.shopName || provider.username,
      returnDistanceKm: route.distanceKm, returnEtaMinutes: route.etaMinutes,
      returnFee: prepaid ? saved.returnFee : routeFee(route.distanceKm, DELIVERY_BASE_FEE, DELIVERY_RATE_PER_KM),
      returnFeePrepaid: prepaid })
  }
  const charge = shipments.reduce((sum, s) => sum + (s.returnFeePrepaid ? 0 : s.returnFee), 0)
  const remainingDeposit = Math.max(0, Number(rental.payment?.depositHeld || 0) -
    (rental.payment?.adjustments || []).reduce((sum, a) => sum + Number(a.amount || 0), 0))
  const quote = { rentalId: String(rental._id), customerId: String(actor._id), collection: location,
    shipments, fee: shipments.reduce((sum, s) => sum + s.returnFee, 0), charge,
    coveredByDeposit: charge <= remainingDeposit,
    distanceKm: shipments.reduce((sum, s) => sum + s.returnDistanceKm, 0), expiresAt: Date.now() + 300000 }
  const payload = Buffer.from(JSON.stringify(quote)).toString('base64url')
  return { ...quote, quoteToken: payload + '.' + hash('return-quote:' + payload) }
}

export async function requestReturn(rentalId, actor, input = {}) {
  if (actor.role !== 'user') throw fail(403, 'CUSTOMER_REQUIRED', 'Only the booking customer can request collection.')
  validId(rentalId)
  const snapshot = await RentalRequest.findOne({ _id: rentalId, customerId: actor._id }).lean()
  if (snapshot?.status === 'active' && snapshot.deliveryReturnRequestedAt)
    return { message: 'Return collection is already requested.' }
  const [payload, signature, extra] = String(input.quoteToken || '').split('.')
  if (!payload || extra || !/^[a-f0-9]{64}$/.test(signature || '') || !equal(signature, hash('return-quote:' + payload)))
    throw fail(400, 'QUOTE_REQUIRED', 'Review the collection route before requesting a partner.')
  let quote
  try { quote = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { throw fail(400, 'INVALID_QUOTE', 'Recalculate your collection route.') }
  if (quote.rentalId !== String(rentalId) || quote.customerId !== String(actor._id) || quote.expiresAt <= Date.now())
    throw fail(409, 'QUOTE_EXPIRED', 'Your collection quote expired. Recalculate the route.')
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const rental = await RentalRequest.findOne({
      _id: rentalId,
      customerId: actor._id,
      status: 'active',
    }).session(session)
    if (!rental)
      throw fail(
        409,
        'RENTAL_CHANGED',
        'The booking changed. Refresh before requesting collection.',
      )
    if (rental.deliveryReturnRequestedAt) return
    if (rental.returnMethod === 'pickup' || rental.returnOtpVerifiedAt || rental.selfReturns.some((c) => c.status === 'verified'))
      throw fail(409, 'RETURN_IN_PROGRESS', 'Self return is already in progress.')
    // Collection not paid for at booking is charged against the held deposit, like late fees,
    // so the deposit refund already accounts for it.
    const charge = quote.shipments.reduce((sum, s) => sum + (s.returnFeePrepaid ? 0 : Number(s.returnFee) || 0), 0)
    if (charge > 0) {
      const remaining = Number(rental.payment?.depositHeld || 0) -
        (rental.payment?.adjustments || []).reduce((sum, a) => sum + Number(a.amount || 0), 0)
      if (charge > remaining)
        throw fail(409, 'DEPOSIT_INSUFFICIENT',
          `Collection costs LKR ${charge.toLocaleString('en-LK')}, more than your remaining deposit. Return the items to the shop yourself, or contact the shop.`)
      rental.payment.adjustments.push({ type: 'return_collection', amount: charge, createdBy: actor._id,
        note: `Partner return collection (${Number(quote.distanceKm || 0).toFixed(1)} km).` })
    }
    rental.returnMethod = 'partner'
    rental.returnDestination = quote.collection
    for (const shipment of quote.shipments) {
      const saved = rental.shipments.find((s) => same(s.providerId, shipment.providerId))
      if (saved) Object.assign(saved, shipment)
      else rental.shipments.push(shipment)
    }
    await createDeliveryTasks(rental, session, 'return')
    rental.deliveryReturnRequestedAt = new Date()
    for (const item of rental.items.filter((i) => i.decision === 'accepted')) {
      item.assignedPartner = undefined
      item.deliveryStatus = 'return_pickup'
    }
    rental.statusHistory.push({
      status: rental.status,
      by: actor._id,
      action: 'return.collection_requested',
      note: 'Customer requested OTP-secured return collection.',
    })
    await rental.save({ session })
    await DeliveryLocation.deleteMany({ rentalId: rental._id }, { session })
    for (const id of new Set(rental.items.map((i) => String(i.providerId))))
      await Notification.create(
        [
          {
            userId: id,
            requestId: rental._id,
            title: 'Return collection requested',
            body: 'Nearby online partners can accept the return trip.',
            link: 'requests',
          },
        ],
        { session },
      )
  })
  await broadcastAvailableTasks()
  return { message: 'Return collection requested. Nearby available partners have been notified.' }
}

async function activeRental(task, session) {
  const query = RentalRequest.findById(task.rentalId)
  if (session) query.session(session)
  const rental = await query
  if (
    !rental ||
    rental.deliveryWorkflowVersion !== 2 ||
    (task.direction === 'delivery' ? rental.deliveryMethod !== 'partner'
      : rental.returnMethod ? rental.returnMethod !== 'partner' : !rental.deliveryReturnRequestedAt) ||
    !['confirmed', 'active', 'return_in_transit'].includes(rental.status) ||
    !task.productIds.every((id) =>
      rental.items.some(
        (i) =>
          same(i.productId, id) && same(i.providerId, task.providerId) && i.decision === 'accepted',
      ),
    )
  )
    throw fail(409, 'RENTAL_CHANGED', 'This booking is no longer eligible for this handover.')
  return rental
}

export async function markReady(id, actor) {
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const task = await getTask(id, actor, session)
    if (!owned(task, actor) || task.direction !== 'delivery')
      throw fail(
        403,
        'PROVIDER_REQUIRED',
        'Only the responsible shop or an administrator can prepare these items.',
      )
    const rental = await activeRental(task, session)
    if (!['authorized', 'paid'].includes(rental.payment?.status))
      throw fail(409, 'PAYMENT_REQUIRED', 'Payment must be recorded before preparing handover.')
    if (task.readyAt) return
    task.readyAt = new Date()
    task.history.push(history(actor, task.status, 'delivery.ready'))
    await task.save({ session })
    const others = await DeliveryTask.exists({
      rentalId: task.rentalId,
      direction: 'delivery',
      readyAt: null,
    }).session(session)
    if (!others) rental.readyForPickupAt = new Date()
    rental.statusHistory.push({
      status: rental.status,
      by: actor._id,
      action: 'delivery.ready',
      note: 'Shop prepared its paid rental shipment.',
    })
    await rental.save({ session })
    await notifyTask(task, 'The shop has prepared the items for OTP-secured collection.', session, actor)
  })
  return { message: 'Shop items are ready for collection.' }
}

const stageFor = (task, kind) => {
  const stages = {
    shop_pickup:
      task.direction === 'delivery' &&
      ['assigned', 'heading_to_shop', 'arrived_at_shop'].includes(task.status),
    customer_delivery:
      task.direction === 'delivery' && ['picked_up', 'on_the_way'].includes(task.status),
    customer_return:
      task.direction === 'return' && ['return_pickup', 'heading_to_customer'].includes(task.status),
    shop_return: task.direction === 'return' && ['collected', 'returning'].includes(task.status),
  }
  return Object.hasOwn(stages, kind) && stages[kind]
}
function canHandover(task, kind, actor) {
  if (kind === 'shop_pickup') return owned(task, actor)
  if (kind === 'customer_return') return actor.role === 'user' && same(task.customerId, actor._id)
  return assigned(task, actor)
}
async function otpContext(task, kind, actor, _verifying = false, session) {
  if (!stageFor(task, kind))
    throw fail(409, 'INVALID_HANDOVER', 'This handover is not the next stage for this task.')
  if (!canHandover(task, kind, actor))
    throw fail(
      403,
      'WRONG_VERIFIER',
      'Only the person handing over the items can send and verify this code.',
    )
  const rental = await activeRental(task, session)
  if (
    kind === 'shop_pickup' &&
    (!['authorized', 'paid'].includes(rental.payment?.status) ||
      !(task.readyAt || rental.readyForPickupAt))
  )
    throw fail(
      409,
      'PICKUP_NOT_READY',
      'The rental must be paid and the shop must mark these items ready before collection.',
    )
  const recipientId = { shop_pickup: task.assignedPartner, customer_delivery: task.customerId,
    customer_return: task.assignedPartner, shop_return: task.providerId }[kind]
  const query = User.findById(recipientId).select('email active role shopStatus')
  if (session) query.session(session)
  const recipient = await query
  if (
    recipient &&
    (['shop_pickup', 'customer_return'].includes(kind)
      ? recipient.role !== 'delivery_partner' : kind === 'customer_delivery' ? recipient.role !== 'user'
        : !['admin', 'rental_shop'].includes(recipient.role) || (recipient.role === 'rental_shop' && recipient.shopStatus !== 'approved'))
  )
    throw fail(
      409,
      'RECIPIENT_CHANGED',
      'The handover account is no longer authorized for this role.',
    )
  if (!recipient?.active || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email || ''))
    throw fail(
      409,
      'EMAIL_REQUIRED',
      'The handover recipient needs an active account with a registered email.',
    )
  return { recipient, rental }
}

export async function sendTaskOtp(id, kind, actor, sendEmail = sendRegistrationOtp) {
  await requireTransactions()
  await identityRate(actor._id, 'delivery-otp-send', 20)
  const task = await getTask(id, actor),
    { recipient } = await otpContext(task, kind, actor)
  const now = new Date(),
    previous = task.otp
  if (previous?.kind === kind && previous.sentAt && now - previous.sentAt < COOLDOWN)
    throw fail(429, 'OTP_COOLDOWN', 'Wait before requesting another handover code.', {
      retryAfter: Math.ceil((COOLDOWN - (now - previous.sentAt)) / 1000),
    })
  const code = String(randomInt(0, 1000000)).padStart(6, '0')
  const otp = {
    id: randomUUID(),
    kind,
    recipientId: recipient._id,
    partnerId: task.assignedPartner,
    emailHash: emailHash(recipient.email),
    maskedEmail: mask(recipient.email),
    sentAt: now,
    expiresAt: new Date(now.getTime() + TTL),
    attempts: 0,
    status: 'sending',
    initiatedBy: actor._id,
  }
  otp.hash = codeHash(task, otp, code)
  const claimed = await DeliveryTask.updateOne(
    { _id: task._id, __v: task.__v, status: task.status, assignedPartner: task.assignedPartner },
    { $set: { otp }, $inc: { __v: 1 } },
  )
  if (!claimed.modifiedCount)
    throw fail(
      409,
      'TASK_CHANGED',
      'This task changed or a code is already being requested. Refresh and retry.',
    )
  const descriptions = {
    shop_pickup: 'collect the rental items from the shop',
    customer_delivery: 'confirm delivery to the customer',
    customer_return: 'collect the return from the customer',
    shop_return: 'confirm receipt at the rental shop',
  }
  if (previous?.id) await removeHandoverOtp(previous.id)
  try {
    await sendEmail(recipient.email, code, {
      subject: 'RentEase delivery handover verification',
      text:
        'Your RentEase handover code is ' +
        code +
        '. It expires in 5 minutes. Use it only to ' +
        descriptions[kind] +
        ' for booking #' +
        task.rentalId +
        '. ' +
        'After receiving the items, give this code to the person handing them over.',
    })
    await mongoose.connection.transaction(async (session) => {
      const sent = await DeliveryTask.updateOne(
        { _id: task._id, status: task.status, assignedPartner: task.assignedPartner,
          'otp.id': otp.id, 'otp.status': 'sending' },
        { $set: { 'otp.status': 'sent' } }, { session },
      )
      if (!sent.modifiedCount) throw fail(409, 'TASK_CHANGED', 'The task changed while sending the code.')
      await publishHandoverOtp({ recipientId: recipient._id, rentalId: task.rentalId,
        taskId: task._id, challengeId: otp.id, code, stage: kind, expiresAt: otp.expiresAt }, session)
    })
  } catch (error) {
    console.error('Delivery OTP email failed:', error.code || error.name)
    await DeliveryTask.updateOne(
      { _id: task._id, 'otp.id': otp.id },
      { $set: { 'otp.status': 'failed' }, $unset: { 'otp.hash': 1 } },
    )
    throw fail(
      502,
      'OTP_DELIVERY_FAILED',
      'The email and private notification could not both be delivered. This code is invalid. Retry after 60 seconds.',
      { retryAfter: 60 },
    )
  }
  return {
    message: 'A handover code was sent to ' + otp.maskedEmail + '.',
    challengeId: otp.id,
    expiresAt: otp.expiresAt,
    resendAt: new Date(now.getTime() + COOLDOWN),
  }
}

async function updateRentalForTask(task, rental, actor, session, kind) {
  for (const item of rental.items.filter((i) =>
    task.productIds.some((id) => same(id, i.productId)),
  ))
    item.deliveryStatus = task.status
  const previousStatus = rental.status,
    now = new Date()
  if (kind === 'customer_delivery') {
    const pending = await DeliveryTask.exists({
      rentalId: rental._id,
      direction: 'delivery',
      status: { $ne: 'delivered' },
    }).session(session)
    if (!pending) {
      rental.status = 'active'
      rental.pickupVerifiedAt = now
      rental.pickupVerifiedBy = actor._id
    }
  }
  if (kind === 'customer_return') rental.status = 'return_in_transit'
  if (kind === 'shop_return') {
    const pending = await DeliveryTask.exists({
      rentalId: rental._id,
      direction: 'return',
      status: { $ne: 'returned' },
    }).session(session)
    if (!pending) {
      rental.status = 'returned'
      rental.returnVerifiedAt = now
      rental.returnVerifiedBy = actor._id
      rental.returnInspection = {
        note: task.inspectionNote,
        inspectedAt: now,
        inspectedBy: actor._id,
      }
      await Product.updateMany(
        { 'rentalSlots.requestId': rental._id },
        { $pull: { rentalSlots: { requestId: rental._id } }, $inc: { __v: 1 } },
        { session },
      )
      await User.updateOne(
        { _id: rental.customerId },
        { $inc: { loyaltyPoints: pointsForItems(rental.items) } },
        { session },
      )
    }
  }
  rental.statusHistory.push({
    previousStatus,
    status: rental.status,
    at: now,
    by: actor._id,
    action: 'delivery.' + kind + '.verified',
    senderId: task.otp.initiatedBy,
    recipientId: task.otp.recipientId,
    verificationId: task.otp.id,
    note: 'OTP-secured ' + kind.replaceAll('_', ' ') + ' for shop shipment.',
  })
  await rental.save({ session })
  await Product.updateMany({ _id: { $in: task.productIds } }, { $inc: { __v: 1 } }, { session })
  if (terminal.includes(task.status)) {
    await User.updateOne(
      { _id: task.assignedPartner, activeDeliveryTask: task._id },
      { $unset: { activeDeliveryTask: 1 }, $inc: { __v: 1 } },
      { session },
    )
    await DeliveryLocation.deleteMany(
      { rentalId: task.rentalId, productId: { $in: task.productIds } },
      { session },
    )
  }
}

export async function verifyTaskOtp(id, input, actor) {
  if (
    typeof input.code !== 'string' ||
    !/^\d{6}$/.test(input.code) ||
    typeof input.challengeId !== 'string'
  )
    throw fail(400, 'INVALID_CODE', 'Enter the six-digit handover code.')
  await identityRate(actor._id, 'delivery-otp-verify', 100)
  const task = await getTask(id, actor)
  const otp = task.otp,
    now = new Date()
  if (!otp || otp.id !== input.challengeId || otp.kind !== input.kind || otp.status !== 'sent')
    throw fail(
      409,
      'CODE_UNAVAILABLE',
      'This code is unavailable or already used. Request a new code.',
    )
  const { recipient } = await otpContext(task, input.kind, actor, true)
  if (!same(otp.initiatedBy, actor._id))
    throw fail(403, 'WRONG_VERIFIER', 'Only the account that sent this code can verify it. Send a new code from your account.')
  if (
    !same(otp.partnerId, task.assignedPartner) ||
    !same(otp.recipientId, recipient._id) ||
    !equal(otp.emailHash, emailHash(recipient.email))
  )
    throw fail(409, 'RECIPIENT_CHANGED', 'The recipient or partner changed. Request a new code.')
  if (otp.expiresAt <= now)
    throw fail(410, 'OTP_EXPIRED', 'The handover code expired. Request a new code.')
  const attempt = await DeliveryTask.updateOne(
    {
      _id: task._id,
      status: task.status,
      'otp.id': otp.id,
      'otp.status': 'sent',
      'otp.expiresAt': { $gt: now },
      'otp.attempts': { $lt: MAX_ATTEMPTS },
    },
    { $inc: { 'otp.attempts': 1, __v: 1 } },
  )
  if (!attempt.modifiedCount)
    throw fail(
      429,
      'CODE_LOCKED',
      'The code changed or has too many failed attempts. Request another code.',
    )
  if (!equal(otp.hash, codeHash(task, otp, input.code)))
    throw fail(
      400,
      'WRONG_CODE',
      'The handover code is incorrect. The task status has not changed.',
    )
  if (
    input.kind === 'shop_return' &&
    input.inspectionNote &&
    (typeof input.inspectionNote !== 'string' ||
      input.inspectionNote.trim().length < 5 ||
      input.inspectionNote.trim().length > 1000)
  )
    throw fail(400, 'INSPECTION_REQUIRED', 'Record a return inspection in 5–1000 characters.')
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const current = await getTask(id, actor, session)
    const { rental, recipient: currentRecipient } = await otpContext(
      current,
      input.kind,
      actor,
      true,
      session,
    )
    if (
      current.otp?.id !== otp.id ||
      current.otp.status !== 'sent' ||
      current.otp.expiresAt <= new Date() ||
      !equal(current.otp.emailHash, emailHash(currentRecipient.email)) ||
      !equal(current.otp.hash, codeHash(current, current.otp, input.code))
    )
      throw fail(
        409,
        'CODE_USED',
        'The code was consumed, expired, or replaced. Refresh your task.',
      )
    const status = {
      shop_pickup: 'picked_up',
      customer_delivery: 'delivered',
      customer_return: 'collected',
      shop_return: 'returned',
    }[input.kind]
    current.status = status
    current.otp.status = 'verified'
    current.otp.verifiedAt = new Date()
    current.otp.hash = undefined
    if (terminal.includes(status)) current.completedAt = new Date()
    if (terminal.includes(status)) current.sharing = false
    if (input.kind === 'shop_return') current.inspectionNote = input.inspectionNote?.trim() || 'Return receipt confirmed by email verification.'
    current.verifications.push({
      kind: input.kind,
      at: new Date(),
      challengeId: otp.id,
      partnerId: current.assignedPartner,
      providerId: current.providerId,
      recipientId: current.otp.recipientId,
      initiatedBy: current.otp.initiatedBy,
      verifiedBy: actor._id,
    })
    current.history.push(history(actor, status, 'delivery.' + input.kind + '.verified'))
    await current.save({ session })
    await removeHandoverOtp(otp.id, session)
    await updateRentalForTask(current, rental, actor, session, input.kind)
    if (terminal.includes(status)) {
      const { recordDeliveryCommission } = await import('../payments/commission.service.mjs')
      await recordDeliveryCommission(current, rental, session)
    }
    await notifyTask(
      current,
      'Verified handover: ' +
        {
          shop_pickup: 'picked up by delivery partner',
          customer_delivery: 'delivered to customer',
          customer_return: 'collected from customer; return in transit',
          shop_return: 'return completed at shop',
        }[input.kind] +
        '.',
      session,
    )
    await AuditLog.create(
      [
        {
          actorId: actor._id,
          actorRole: actor.role,
          action: 'delivery.' + input.kind + '.verified',
          entityType: 'delivery_task',
          entityId: String(current._id),
          summary:
            'Verified single-use handover challenge ' +
            otp.id +
            ' for partner ' +
            current.assignedPartner +
            ' and shop ' +
            current.providerId +
            '.',
        },
      ],
      { session },
    )
  })
  await broadcastAvailableTasks()
  return { message: 'Handover verified. Delivery and rental progress have been updated.' }
}

export async function progressTask(id, status, actor) {
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const task = await getTask(id, actor, session)
    if (!assigned(task, actor))
      throw fail(403, 'PARTNER_REQUIRED', 'Only the assigned partner can update this trip.')
    const next = {
      assigned: 'heading_to_shop',
      heading_to_shop: 'arrived_at_shop',
      picked_up: 'on_the_way',
      return_pickup: 'heading_to_customer',
      collected: 'returning',
    }[task.status]
    if (!next || next !== status)
      throw fail(
        409,
        'OTP_REQUIRED',
        'This transition requires its handover OTP. Stages cannot be skipped.',
      )
    const rental = await activeRental(task, session)
    task.status = status
    task.history.push(history(actor, status, 'delivery.progress'))
    await task.save({ session })
    for (const item of rental.items.filter((i) =>
      task.productIds.some((id) => same(id, i.productId)),
    ))
      item.deliveryStatus = status
    await rental.save({ session })
    await notifyTask(task, 'Delivery status: ' + status.replaceAll('_', ' ') + '.', session, actor)
  })
  return { message: 'Trip progress updated.' }
}

export async function cancelDeliveryTasks(rentalId, session, reason = 'cancelled') {
  const tasks = await DeliveryTask.find({
    rentalId,
    status: { $nin: ['delivered', 'returned', 'cancelled'] },
  }).select('+otp').session(session)
  for (const task of tasks) {
    await User.updateOne(
      { _id: task.assignedPartner, activeDeliveryTask: task._id },
      { $unset: { activeDeliveryTask: 1 } },
      { session },
    )
    const pendingCode = task.otp?.id
    task.status = 'cancelled'
    task.otp = undefined
    task.sharing = false
    task.history.push({ status: 'cancelled', action: `booking.${reason}`, at: new Date() })
    await task.save({ session })
    if (pendingCode) await removeHandoverOtp(pendingCode, session)
    if (task.assignedPartner)
      await Notification.create([{
        userId: task.assignedPartner, requestId: task.rentalId, type: 'delivery', link: 'requests',
        title: 'Trip cancelled',
        body: reason === 'disputed'
          ? 'This booking is under review, so the trip was cancelled. You are free to accept other requests.'
          : 'The booking for this trip was cancelled. You are free to accept other requests.',
      }], { session })
  }
  await clearOffers(tasks.map((task) => task._id), session)
  await DeliveryLocation.deleteMany({ rentalId }, { session })
}

// Stages where the rider has accepted but not yet taken custody of anything.
const releasable = {
  delivery: ['assigned', 'heading_to_shop', 'arrived_at_shop'],
  return: ['return_pickup', 'heading_to_customer'],
}

// A rider who cannot complete a trip before collecting the items (or the shop or an admin on
// their behalf) hands it back; the search restarts without that rider so the booking is not stuck.
export async function releaseTask(id, actor) {
  if (!['delivery_partner', 'rental_shop', 'admin'].includes(actor.role))
    throw fail(403, 'RELEASE_FORBIDDEN', 'Only the rider, the shop or an administrator can release this trip.')
  let released
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const task = await getTask(id, actor, session)
    if (!assigned(task, actor) && !owned(task, actor))
      throw fail(403, 'RELEASE_FORBIDDEN', 'Only the assigned rider, the shop or an administrator can release this trip.')
    if (!task.assignedPartner || !releasable[task.direction].includes(task.status))
      throw fail(409, 'IN_CUSTODY', 'The rider already has the items. Complete the handover instead.')
    const rental = await activeRental(task, session)
    const riderId = task.assignedPartner
    const byRider = assigned(task, actor)
    const pendingCode = task.otp?.id
    const now = new Date()
    task.status = 'available'
    task.assignedPartner = null
    task.acceptedAt = undefined
    task.sharing = false
    task.otp = undefined
    task.offeredPartnerIds = []
    task.declinedPartnerIds = [...task.declinedPartnerIds, riderId]
    task.search = { state: 'searching', radiusMeters: SEARCH_RADII[0], round: 0, startedAt: now, nextExpansionAt: now }
    task.history.push(history(actor, 'available', 'delivery.released'))
    await task.save({ session })
    if (pendingCode) await removeHandoverOtp(pendingCode, session)
    await User.updateOne({ _id: riderId, activeDeliveryTask: task._id }, { $unset: { activeDeliveryTask: 1 }, $inc: { __v: 1 } }, { session })
    for (const item of rental.items.filter((i) => task.productIds.some((pid) => same(pid, i.productId)))) {
      item.assignedPartner = undefined
      item.deliveryStatus = task.direction === 'delivery' ? 'assigned' : 'return_pickup'
    }
    rental.statusHistory.push({ status: rental.status, by: actor._id, action: 'delivery.released',
      note: byRider ? 'The rider released the trip before collection.' : 'The trip was released from its rider before collection.' })
    await rental.save({ session })
    await DeliveryLocation.deleteMany({ rentalId: rental._id, productId: { $in: task.productIds } }, { session })
    const recipients = [task.customerId, task.providerId, riderId].filter((userId) => !same(userId, actor._id))
    await Notification.insertMany(recipients.map((userId) => ({
      userId, requestId: task.rentalId, type: 'delivery', link: 'requests',
      title: same(userId, riderId) ? 'Trip released' : 'Finding another rider',
      body: same(userId, riderId)
        ? 'This trip was released from you before collection. You are free to accept other requests.'
        : 'The assigned rider could not complete this trip. We are searching for another nearby rider.',
    })), { session })
    released = task._id
  })
  await broadcastAvailableTasks()
  return { message: 'Trip released. We are finding another rider.', taskId: released }
}

// Lets a customer whose collection nobody accepted return the items themselves instead.
// Only possible before a rider accepts; the collection charge comes off the deposit again.
export async function cancelReturnCollection(rentalId, actor) {
  if (actor.role !== 'user') throw fail(403, 'CUSTOMER_REQUIRED', 'Only the booking customer can change the return.')
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const rental = await RentalRequest.findOne({ _id: validId(rentalId), customerId: actor._id }).session(session)
    if (!rental || rental.status !== 'active' || rental.returnMethod !== 'partner')
      throw fail(409, 'NO_COLLECTION', 'This rental has no partner collection to cancel.')
    const tasks = await DeliveryTask.find({ rentalId: rental._id, direction: 'return' }).session(session)
    if (tasks.some((task) => task.status !== 'available' || task.assignedPartner))
      throw fail(409, 'RIDER_ASSIGNED', 'A rider has already accepted this collection. Hand the items to the rider.')
    await clearOffers(tasks.map((task) => task._id), session)
    // Unaccepted collections hold no handover record, and removing them lets a later request start fresh.
    await DeliveryTask.deleteMany({ _id: { $in: tasks.map((task) => task._id) } }, { session })
    const refunded = rental.payment.adjustments
      .filter((adjustment) => adjustment.type === 'return_collection')
      .reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0)
    rental.payment.adjustments = rental.payment.adjustments.filter((adjustment) => adjustment.type !== 'return_collection')
    rental.returnMethod = undefined
    rental.returnDestination = undefined
    rental.deliveryReturnRequestedAt = undefined
    for (const item of rental.items.filter((i) => i.decision === 'accepted'))
      item.deliveryStatus = rental.deliveryMethod === 'partner' ? 'delivered' : 'assigned'
    rental.statusHistory.push({
      status: rental.status,
      by: actor._id,
      action: 'return.collection_cancelled',
      note: refunded ? `Customer chose self return. Collection charge of LKR ${refunded} released.` : 'Customer chose self return.',
    })
    await rental.save({ session })
  })
  return { message: 'Collection cancelled. Return the items to the shop yourself; any collection charge was released.' }
}
