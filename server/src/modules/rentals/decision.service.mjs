import mongoose from 'mongoose'
import { RentalRequest } from './rental.model.mjs'
import { Product } from '../products/product.model.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'
import { identityError } from '../identity/identity-security.service.mjs'
import {
  assertRentalEligible,
  identityNotification,
  emailIdentityNotice,
} from '../identity/identity.service.mjs'
import { requireTransactions } from '../../services/mongo-transactions.mjs'
import { inventoryAvailability } from '../products/availability.service.mjs'
import { createDeliveryTasks, broadcastAvailableTasks } from '../delivery/delivery-task.service.mjs'

export async function decideRentalItem({ actor, rentalId, productId, decision, reason = '' }) {
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
  await requireTransactions()
  let rental, item
  await mongoose.connection.transaction(async (session) => {
    const itemScope = actor.role === 'admin' ? { productId } : { productId, providerId: actor._id }
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
    const previousStatus = rental.status
    if (rental.items.every((row) => row.decision === 'accepted')) rental.status = 'confirmed'
    if (rental.items.every((row) => row.decision === 'rejected')) {
      rental.status = 'cancelled'
      rental.cancelledAt = new Date()
      rental.cancellationReason = 'All rental items declined.'
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
