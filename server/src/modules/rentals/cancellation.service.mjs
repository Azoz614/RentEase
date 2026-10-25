import { cancelDeliveryTasks } from '../delivery/delivery-task.service.mjs'
import mongoose from 'mongoose'
import { RentalRequest } from './rental.model.mjs'
import { Product } from '../products/product.model.mjs'
import { AuditLog } from '../admin/audit-log.model.mjs'
import { SystemSetting } from '../admin/system-setting.model.mjs'
import { requireTransactions } from '../../services/mongo-transactions.mjs'
import { DeliveryLocation } from '../delivery/delivery-location.model.mjs'

const fail = (status, message) => Object.assign(new Error(message), { status })
export async function cancellationWindowHours() {
  const settings = await SystemSetting.findOne({ key: 'platform' })
    .select('cancellationWindowHours')
    .lean()
  return Number(settings?.cancellationWindowHours ?? 24)
}
export function cancellationEligibility(rental, hours, now = Date.now()) {
  if (
    rental.deliveryWorkflowVersion === 2 &&
    rental.items?.some((i) =>
      ['picked_up', 'on_the_way', 'delivered', 'collected', 'returning'].includes(i.deliveryStatus),
    )
  )
    return {
      allowed: false,
      reason: 'Items are already in delivery custody and must follow the verified return workflow.',
    }
  if (!['pending', 'confirmed'].includes(rental.status))
    return { allowed: false, reason: 'Only pending or booked rentals can be cancelled.' }
  if (
    rental.status === 'confirmed' &&
    new Date(rental.startDate).getTime() - now < hours * 3_600_000
  )
    return {
      allowed: false,
      reason: `Confirmed rentals must be cancelled at least ${hours} hours before collection.`,
    }
  return {
    allowed: true,
    reason: '',
    cutoffAt:
      rental.status === 'confirmed'
        ? new Date(new Date(rental.startDate).getTime() - hours * 3_600_000)
        : null,
  }
}

export async function cancelRental({
  rentalId,
  actor,
  reason = '',
  customerFlow = true,
  ipAddress = '',
}) {
  if (!mongoose.isValidObjectId(rentalId)) throw fail(400, 'Choose a valid rental booking.')
  if (typeof reason !== 'string' || reason.trim().length > 500)
    throw fail(400, 'Cancellation reason must be 500 characters or fewer.')
  await requireTransactions()
  const hours = await cancellationWindowHours()
  let updated
  await mongoose.connection.transaction(async (session) => {
    const rental = await RentalRequest.findOne({
      _id: rentalId,
      ...(customerFlow ? { customerId: actor._id } : {}),
    }).session(session)
    if (
      !rental ||
      (!customerFlow &&
        actor.role !== 'admin' &&
        !rental.items.some((item) => String(item.providerId) === String(actor._id)))
    )
      throw fail(404, 'Rental booking not found.')
    if (customerFlow) {
      const eligibility = cancellationEligibility(rental, hours)
      if (!eligibility.allowed) throw fail(409, eligibility.reason)
    } else if (!['pending', 'confirmed', 'disputed'].includes(rental.status))
      throw fail(409, 'This booking cannot be cancelled in its current status.')
    if (
      rental.deliveryWorkflowVersion === 2 &&
      rental.items.some((i) =>
        ['picked_up', 'on_the_way', 'delivered', 'collected', 'returning'].includes(
          i.deliveryStatus,
        ),
      )
    )
      throw fail(
        409,
        'Items in delivery custody require a verified return and cannot be cancelled.',
      )
    const now = new Date()
    const fields = { status: 'cancelled', cancelledAt: now, cancellationReason: reason.trim() }
    // Never simulate a refund for a real payment provider.
    if (rental.payment?.status === 'authorized' && rental.payment.provider === 'sandbox')
      Object.assign(fields, {
        'payment.status': 'refunded',
        'payment.depositRefunded': rental.payment.depositHeld,
        'payment.refundedAt': now,
      })
    updated = await RentalRequest.findOneAndUpdate(
      { _id: rentalId, status: rental.status, __v: rental.__v },
      {
        $set: fields,
        $unset: { handover: 1 },
        $inc: { __v: 1 },
        $push: {
          statusHistory: {
            previousStatus: rental.status,
            status: 'cancelled',
            action: 'booking.cancelled',
            by: actor._id,
            at: now,
            note:
              reason.trim() ||
              (customerFlow ? 'Cancelled by customer.' : 'Cancelled by rental staff.'),
          },
        },
      },
      { session, returnDocument: 'after', runValidators: true },
    )
    if (!updated) throw fail(409, 'The rental changed. Refresh before cancelling.')
    await cancelDeliveryTasks(rental._id, session)
    await DeliveryLocation.deleteMany({ rentalId: rental._id }, { session })
    await Product.updateMany(
      { 'rentalSlots.requestId': rental._id },
      { $pull: { rentalSlots: { requestId: rental._id } } },
      { session },
    )
    const { identityNotification } = await import('../identity/identity.service.mjs')
    await identityNotification(
      rental.customerId,
      'Rental Cancelled',
      'Your booking was cancelled. Pending handover codes are invalid and inventory has been released. Your rental history is retained.',
      'requests',
      session,
      rental._id,
    )
    for (const providerId of [...new Set(rental.items.map((item) => String(item.providerId)))])
      await identityNotification(
        providerId,
        'Rental Cancellation Update',
        'A rental request was cancelled and its reserved items released. Review your rental workspace.',
        'requests',
        session,
        rental._id,
      )
    await AuditLog.create(
      [
        {
          actorId: actor._id,
          actorRole: actor.role,
          action: 'booking.cancelled',
          entityType: 'rental_request',
          entityId: String(rentalId),
          summary:
            'Rental cancelled; outstanding verification codes invalidated and inventory released.',
          ipAddress,
        },
      ],
      { session },
    )
  })
  const { emailIdentityNotice } = await import('../identity/identity.service.mjs')
  await emailIdentityNotice(
    updated.customerId,
    'Rental Cancelled',
    'Your booking was cancelled and pending handover codes invalidated. Review My rentals for the recorded details.',
  )
  return updated.toObject()
}
