import mongoose from 'mongoose'
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { DeliveryTask } from './delivery-task.model.mjs'
import { PartnerPresence } from './partner-presence.model.mjs'
import { DeliveryLocation } from './delivery-location.model.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { Product } from '../products/product.model.mjs'
import { User } from '../users/user.model.mjs'
import { Notification } from '../notifications/notification.model.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'
import { point } from '../maps/location.service.mjs'
import { drivingRoute } from './delivery-quote.service.mjs'
import { identityRate } from '../identity/identity-security.service.mjs'
import { sendRegistrationOtp } from '../../config/mailer.js'
import { requireTransactions } from '../../services/mongo-transactions.mjs'
import { createHttpError as fail } from '../../utils/http-error.mjs'

export const SEARCH_RADIUS_METERS = 10000
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
  if (rental.deliveryMethod !== 'partner') return
  if (!rental.deliveryDestination?.location)
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
            ? rental.deliveryDestination
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
          history: [{ status: 'available', action: 'delivery.offered', at: new Date() }],
        },
      },
      { session, upsert: true, runValidators: true },
    )
  }
  rental.deliveryWorkflowVersion = 2
}

export async function broadcastAvailableTasks() {
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
    for await (const task of DeliveryTask.find({ status: 'available' }).lean().cursor()) {
      const rental = await RentalRequest.findById(task.rentalId).select('status').lean()
      if (!rental || !['confirmed', 'active', 'return_in_transit'].includes(rental.status)) continue
      const near = await PartnerPresence.find({
        online: true,
        expiresAt: { $gt: new Date() },
        location: {
          $near: { $geometry: point(task.pickup.location), $maxDistance: SEARCH_RADIUS_METERS },
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
      const offered = await DeliveryTask.updateOne(
        { _id: task._id, status: 'available' },
        { $addToSet: { offeredPartnerIds: { $each: fresh.map((p) => p._id) } } },
      )
      if (!offered.modifiedCount) continue
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
        })),
      )
    }
  } catch (error) {
    console.error('Delivery offer refresh deferred:', error.name)
  }
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
        'pickup.location': {
          $near: { $geometry: point(presence.location), $maxDistance: SEARCH_RADIUS_METERS },
        },
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
    .select('status payment.status readyForPickupAt deliveryReturnRequestedAt')
    .lean()
  const people = await User.find({
    _id: { $in: tasks.flatMap((t) => [t.assignedPartner, t.providerId]).filter(Boolean) },
  })
    .select('username shopName phone')
    .lean()
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
        return {
          id: t._id,
          rentalId: t.rentalId,
          direction: t.direction,
          titles: t.titles,
          status: t.status,
          pickup: t.pickup,
          destination: t.destination,
          distanceKm: t.distanceKm ?? null,
          etaMinutes: t.etaMinutes ?? null,
          fee: t.fee,
          rentalStatus: rental.status,
          paid: ['authorized', 'paid'].includes(rental.payment?.status),
          ready: Boolean(t.readyAt || rental.readyForPickupAt),
          returnRequested: Boolean(rental.deliveryReturnRequestedAt),
          partner: p ? { id: p._id, name: p.username, phone: p.phone || '' } : null,
          shop: provider?.shopName || provider?.username || 'Rental shop',
          canManage: owned(t, actor),
          canOperate: assigned(t, actor),
          history: t.history,
          challenge:
            t.otp?.status === 'sent'
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

async function notifyTask(task, message, session) {
  for (const id of new Set(
    [task.customerId, task.providerId, task.assignedPartner].filter(Boolean).map(String),
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
      $near: { $geometry: point(task.pickup.location), $maxDistance: SEARCH_RADIUS_METERS },
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
      },
      {
        $set: { assignedPartner: actor._id, acceptedAt: new Date(), status, sharing: true, locationUpdatedAt: near.updatedAt },
        $push: { history: history(actor, status, 'delivery.accepted') },
        $inc: { __v: 1 },
      },
      { session, returnDocument: 'after' },
    )
    if (!accepted)
      throw fail(
        409,
        'ALREADY_ASSIGNED',
        'Another partner accepted this task. Refresh your nearby requests.',
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
    await notifyTask(
      accepted,
      'A delivery partner accepted your ' +
        accepted.direction +
        ' task. Contact details are available in delivery tracking.',
      session,
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
  return { message: 'Request declined. Other nearby partners can still accept it.' }
}

export async function requestReturn(rentalId, actor) {
  if (actor.role !== 'user')
    throw fail(403, 'CUSTOMER_REQUIRED', 'Only the booking customer can request collection.')
  const snapshot = await RentalRequest.findOne({
    _id: validId(rentalId),
    customerId: actor._id,
    deliveryWorkflowVersion: 2,
    deliveryMethod: 'partner',
  }).lean()
  if (!snapshot || snapshot.status !== 'active')
    throw fail(
      409,
      'INVALID_RETURN',
      'Only a delivered rental currently on rental can be collected.',
    )
  if (snapshot.deliveryReturnRequestedAt)
    return { message: 'Return collection is already requested.' }
  const routes = new Map()
  for (const shipment of snapshot.shipments) {
    if (shipment.returnDistanceKm != null) continue
    try {
      routes.set(
        String(shipment.providerId),
        await drivingRoute(snapshot.deliveryDestination.location, shipment.origin),
      )
    } catch {
      /* Collection can be requested during a routing outage. No distance or travel time is invented. */
    }
  }
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
    await createDeliveryTasks(rental, session, 'return', routes)
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
    rental.deliveryMethod !== 'partner' ||
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
    await notifyTask(task, 'The shop has prepared the items for OTP-secured collection.', session)
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
async function otpContext(task, kind, actor, verifying = false, session) {
  if (!stageFor(task, kind))
    throw fail(409, 'INVALID_HANDOVER', 'This handover is not the next stage for this task.')
  if (kind === 'shop_return' && verifying ? !owned(task, actor) : !assigned(task, actor))
    throw fail(
      403,
      'WRONG_VERIFIER',
      kind === 'shop_return' && verifying
        ? 'Only the responsible shop owner or an administrator can verify the shop return.'
        : 'Only the assigned delivery partner can perform this handover.',
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
  const recipientId =
    kind === 'shop_pickup'
      ? task.providerId
      : kind === 'shop_return'
        ? task.assignedPartner
        : task.customerId
  const query = User.findById(recipientId).select('email active role shopStatus')
  if (session) query.session(session)
  const recipient = await query
  if (
    recipient &&
    (kind === 'shop_pickup'
      ? !['admin', 'rental_shop'].includes(recipient.role) ||
        (recipient.role === 'rental_shop' && recipient.shopStatus !== 'approved')
      : kind === 'shop_return'
        ? recipient.role !== 'delivery_partner'
        : recipient.role !== 'user')
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

export async function sendTaskOtp(id, kind, actor) {
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
    { _id: task._id, __v: task.__v, status: task.status, assignedPartner: actor._id },
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
  try {
    await sendRegistrationOtp(recipient.email, code, {
      subject: 'RentEase delivery handover verification',
      text:
        'Your RentEase handover code is ' +
        code +
        '. It expires in 5 minutes. Use it only to ' +
        descriptions[kind] +
        ' for booking #' +
        task.rentalId +
        '. ' +
        (kind === 'shop_return'
          ? 'Give this code to the authorized shop owner or administrator.'
          : 'Give this code to your assigned delivery partner.'),
    })
  } catch (error) {
    console.error('Delivery OTP email failed:', error.code || error.name)
    await DeliveryTask.updateOne(
      { _id: task._id, 'otp.id': otp.id },
      { $set: { 'otp.status': 'failed' }, $unset: { 'otp.hash': 1 } },
    )
    throw fail(
      502,
      'EMAIL_FAILED',
      'The handover email could not be sent. Retry after 60 seconds.',
      { retryAfter: 60 },
    )
  }
  const sent = await DeliveryTask.updateOne(
    { _id: task._id, status: task.status, 'otp.id': otp.id, 'otp.status': 'sending' },
    { $set: { 'otp.status': 'sent' } },
  )
  if (!sent.modifiedCount)
    throw fail(
      409,
      'TASK_CHANGED',
      'This task changed while the email was sending. Refresh before continuing.',
    )
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
      const points = rental.items.reduce(
        (n, i) => n + Math.max(1, Math.floor(Number(i.rentalAmount || 0) / 1000)),
        0,
      )
      await User.updateOne(
        { _id: rental.customerId },
        { $inc: { loyaltyPoints: points } },
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
    if (input.kind === 'shop_return') current.inspectionNote = input.inspectionNote.trim()
    current.verifications.push({
      kind: input.kind,
      at: new Date(),
      challengeId: otp.id,
      partnerId: current.assignedPartner,
      providerId: current.providerId,
      recipientId: current.otp.recipientId,
      verifiedBy: actor._id,
    })
    current.history.push(history(actor, status, 'delivery.' + input.kind + '.verified'))
    await current.save({ session })
    await updateRentalForTask(current, rental, actor, session, input.kind)
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
    await notifyTask(task, 'Delivery status: ' + status.replaceAll('_', ' ') + '.', session)
  })
  return { message: 'Trip progress updated.' }
}

export async function cancelDeliveryTasks(rentalId, session) {
  const tasks = await DeliveryTask.find({
    rentalId,
    status: { $nin: ['delivered', 'returned', 'cancelled'] },
  }).session(session)
  for (const task of tasks) {
    await User.updateOne(
      { _id: task.assignedPartner, activeDeliveryTask: task._id },
      { $unset: { activeDeliveryTask: 1 } },
      { session },
    )
    task.status = 'cancelled'
    task.otp = undefined
    task.history.push({ status: 'cancelled', action: 'booking.cancelled', at: new Date() })
    await task.save({ session })
  }
}
