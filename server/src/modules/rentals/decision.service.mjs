import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { RentalRequest } from './rental.model.mjs'
import { Product } from '../products/product.model.mjs'
import { User } from '../users/user.model.mjs'
import { restoreLoyaltyReward } from '../loyalty/loyalty.service.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'
import { identityError } from '../identity/identity-security.service.mjs'
import {
  assertRentalEligible,
  identityNotification,
  emailIdentityNotice,
} from '../identity/identity.service.mjs'
import { requireTransactions } from '../../services/mongo-transactions.mjs'
import { releaseCoupon } from '../payments/coupon.service.mjs'
import { inventoryAvailability } from '../products/availability.service.mjs'
import { createDeliveryTasks, broadcastAvailableTasks } from '../delivery/delivery-task.service.mjs'

const round = (amount) => Math.round(amount * 100) / 100
const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0)

export const APPROVAL_PASSWORD_ATTEMPTS = 3
export const APPROVAL_LOCK_MS = 10 * 60_000

function approvalLocked(until, now) {
  const retryAfter = Math.max(1, Math.ceil((until - now) / 1000))
  return Object.assign(
    identityError(
      429,
      'APPROVAL_LOCKED',
      `Too many incorrect passwords. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
    ),
    { retryAfter },
  )
}

// Accepting a rental reserves stock for a customer, so the shop owner or administrator confirms
// it with their account password. Administrators also confirm every admin workspace change with
// it. Three wrong entries block approvals for ten minutes.
export async function confirmApprovalPassword(
  actorId,
  password,
  { now = new Date(), purpose = 'to accept this rental' } = {},
) {
  const user = await User.findById(actorId).select(
    '+password +approvalPasswordFailures +approvalPasswordLockedUntil',
  )
  if (!user) throw identityError(404, 'ACCOUNT_NOT_FOUND', 'Your account could not be found.')
  const lockedUntil = user.approvalPasswordLockedUntil
  if (lockedUntil > now) throw approvalLocked(lockedUntil, now)
  if (typeof password !== 'string' || !password || password.length > 128)
    throw identityError(400, 'PASSWORD_REQUIRED', `Enter your account password ${purpose}.`)
  const stored = user.approvalPasswordFailures ?? null
  if (await bcrypt.compare(password, user.password)) {
    if (stored !== null || lockedUntil)
      await User.updateOne(
        { _id: actorId },
        { $unset: { approvalPasswordFailures: 1, approvalPasswordLockedUntil: 1 } },
      )
    return
  }
  // An expired lock starts a fresh set of attempts.
  const failures = (lockedUntil ? 0 : stored || 0) + 1
  const lockUntil = failures >= APPROVAL_PASSWORD_ATTEMPTS ? new Date(now.getTime() + APPROVAL_LOCK_MS) : null
  // Matching the count that was read stops parallel wrong guesses from sharing one attempt.
  const counted = await User.updateOne(
    { _id: actorId, approvalPasswordFailures: stored },
    lockUntil
      ? { $set: { approvalPasswordFailures: failures, approvalPasswordLockedUntil: lockUntil } }
      : { $set: { approvalPasswordFailures: failures }, $unset: { approvalPasswordLockedUntil: 1 } },
  )
  if (!counted.modifiedCount)
    throw identityError(409, 'APPROVAL_BUSY', 'Another approval attempt was just made. Try again.')
  if (lockUntil) throw approvalLocked(lockUntil, now)
  const left = APPROVAL_PASSWORD_ATTEMPTS - failures
  throw identityError(
    403,
    'PASSWORD_INCORRECT',
    `Incorrect password. ${left} attempt${left === 1 ? '' : 's'} left before approvals are locked for 10 minutes.`,
  )
}

// When some items are approved and the rest declined, the booking continues with the approved
// items only. Declined items move to declinedItems, so every check that expects "all items
// approved" still holds, and the price, delivery and coupon share are recalculated.
export function keepApprovedItems(rental) {
  const declined = rental.items.filter((row) => row.decision === 'rejected')
  rental.declinedItems.push(
    ...declined.map(({ productId, providerId, title, rentalAmount, depositAmount, decisionReason }) => ({
      productId, providerId, title, rentalAmount, depositAmount, decisionReason,
    })),
  )
  rental.items = rental.items.filter((row) => row.decision === 'accepted')
  const providers = new Set(rental.items.map((row) => String(row.providerId)))
  rental.shipments = rental.shipments.filter((shipment) => providers.has(String(shipment.providerId)))
  const previousSubtotal = Number(rental.subtotal || 0)
  rental.subtotal = round(sum(rental.items, 'rentalAmount'))
  // The coupon keeps the same proportion of the smaller subtotal and never grows.
  rental.discountAmount = previousSubtotal > 0
    ? Math.min(rental.subtotal, Math.round((Number(rental.discountAmount || 0) * rental.subtotal) / previousSubtotal))
    : 0
  if (rental.shipments.length) {
    rental.returnCollectionFee = round(sum(rental.shipments, 'returnFee'))
    rental.deliveryFee = round(sum(rental.shipments, 'fee') + rental.returnCollectionFee)
    rental.distanceKm = round(sum(rental.shipments, 'distanceKm'))
    rental.etaMinutes = Math.max(0, ...rental.shipments.map((shipment) => Number(shipment.etaMinutes || 0)))
  }
  rental.total = round(rental.subtotal - rental.discountAmount + Number(rental.deliveryFee || 0))
  return declined.length
}

export async function decideRentalItem({
  actor,
  rentalId,
  productId,
  decision,
  reason = '',
  password,
}) {
  if (!['admin', 'rental_shop'].includes(actor.role))
    throw identityError(403, 'PROVIDER_REQUIRED', 'Provider access is required.')
  if (!mongoose.isValidObjectId(rentalId) || !mongoose.isValidObjectId(productId))
    throw identityError(400, 'INVALID_RENTAL', 'Choose a valid rental item.')
  if (!['accepted', 'rejected'].includes(decision))
    throw identityError(400, 'INVALID_DECISION', 'Choose accept or reject.')
  if (
    decision === 'rejected' &&
    (typeof reason !== 'string' || reason.trim().length < 5 || reason.trim().length > 500)
  )
    throw identityError(400, 'REASON_REQUIRED', 'Enter a rejection reason in 5–500 characters.')
  // Requests belong to the shop (or administrator) that published the item; nobody else decides.
  const itemScope = { productId, providerId: actor._id }
  if (!(await RentalRequest.exists({ _id: rentalId, items: { $elemMatch: itemScope } })))
    throw identityError(404, 'RENTAL_NOT_FOUND', 'Rental request not found for this provider.')
  if (decision === 'accepted') await confirmApprovalPassword(actor._id, password)
  await requireTransactions()
  let rental, item
  await mongoose.connection.transaction(async (session) => {
    rental = await RentalRequest.findOne({
      _id: rentalId,
      items: { $elemMatch: itemScope },
    }).session(session)
    if (!rental)
      throw identityError(404, 'RENTAL_NOT_FOUND', 'Rental request not found for this provider.')
    if (!['pending', 'confirmed'].includes(rental.status))
      throw identityError(409, 'INVALID_STATUS', 'This rental can no longer accept item decisions.')
    item = rental.items.find((row) => String(row.productId) === productId)
    if (item.decision !== 'pending')
      throw identityError(409, 'DECISION_EXISTS', 'This item already has a decision.')
    if (decision === 'accepted') {
      await assertRentalEligible(rental.customerId, session)
      const product = await Product.findById(productId).session(session)
      if (
        !product?.active ||
        !(await inventoryAvailability([product], rental.startDate, rental.endDate, rental._id)).get(
          productId,
        ).available
      )
        throw identityError(
          409,
          'ITEM_UNAVAILABLE',
          'This item is no longer available. Resolve the conflict or reject the request.',
        )
    }
    item.decision = decision
    item.decisionReason = decision === 'rejected' ? reason.trim() : ''
    if (decision === 'rejected' && String(rental.loyaltyReward?.productId) === productId)
      await restoreLoyaltyReward(rental, session)
    const previousStatus = rental.status
    let repriced = false
    if (
      rental.items.every((row) => row.decision !== 'pending') &&
      rental.items.some((row) => row.decision === 'accepted') &&
      rental.items.some((row) => row.decision === 'rejected')
    ) {
      keepApprovedItems(rental)
      repriced = true
    }
    if (rental.items.every((row) => row.decision === 'accepted')) rental.status = 'confirmed'
    if (rental.items.every((row) => row.decision === 'rejected')) {
      rental.status = 'cancelled'
      rental.cancelledAt = new Date()
      rental.cancellationReason = 'All rental items declined.'
      await releaseCoupon(rental.couponCode, session)
      rental.handover = undefined
    }
    rental.statusHistory.push({
      previousStatus,
      status: rental.status,
      by: actor._id,
      action: `booking.item.${decision}`,
      note:
        decision === 'accepted'
          ? 'Rental item approved. Payment opens after every item is accepted.'
          : reason.trim(),
    })
    if (repriced)
      rental.statusHistory.push({
        previousStatus,
        status: rental.status,
        by: actor._id,
        action: 'booking.repriced',
        note: `Continuing with ${rental.items.length} approved item(s). New total LKR ${rental.total}.`,
      })
    if (rental.status === 'confirmed' && rental.deliveryMethod === 'partner')
      await createDeliveryTasks(rental, session)
    await rental.save({ session })
    await Product.updateOne(
      { _id: productId },
      decision === 'rejected'
        ? { $pull: { rentalSlots: { requestId: rental._id } }, $inc: { __v: 1 } }
        : { $set: { 'rentalSlots.$[slot].status': 'accepted' }, $inc: { __v: 1 } },
      {
        session,
        ...(decision === 'accepted' ? { arrayFilters: [{ 'slot.requestId': rental._id }] } : {}),
      },
    )
    await identityNotification(
      rental.customerId,
      decision === 'accepted' ? 'Rental Request Approved' : 'Rental Request Rejected',
      decision === 'accepted'
        ? `${item.title} was approved. Review My rentals for payment and pickup preparation.`
        : `${item.title} was declined: ${reason.trim()}`,
      'requests',
      session,
      rental._id,
    )
    if (repriced)
      await identityNotification(
        rental.customerId,
        'Booking updated',
        `Your booking continues with the ${rental.items.length} approved item(s). The new total is LKR ${rental.total.toLocaleString('en-LK')}; you can pay now or cancel.`,
        'requests',
        session,
        rental._id,
      )
    await AuditLog.create(
      [
        {
          actorId: actor._id,
          actorRole: actor.role,
          action: `booking.item.${decision}`,
          entityType: 'rental_request',
          entityId: String(rental._id),
          summary: `Recorded item decision ${decision}; inventory and notification committed together.`,
        },
      ],
      { session },
    )
  })
  if (rental.deliveryMethod === 'partner' && rental.status === 'confirmed')
    await broadcastAvailableTasks()
  await emailIdentityNotice(
    rental.customerId,
    'Rental Request Update',
    decision === 'accepted'
      ? `${item.title} was approved. Review My rentals for the next steps.`
      : `${item.title} was declined. Open My rentals to review the feedback.`,
  )
  return { message: `Request ${decision}.`, request: rental.toObject() }
}
