import { Notification } from '../notifications/notification.model.mjs'
import { Product } from '../products/product.model.mjs'
import { pickupWorkflow, returnWorkflow } from './handover.service.mjs'
import { cancellationWindowHours, cancellationEligibility } from './cancellation.service.mjs'

// Explicit customer DTOs: never return a rental document or populated administrator wholesale.
export const customerRentalFields =
  '_id customerId items startDate endDate addressSnapshot createdAt updatedAt status subtotal total deliveryMethod deliveryWorkflowVersion deliveryReturnRequestedAt address deliveryFee distanceKm etaMinutes deliveryDestination deliveryQuotedAt estimatedArrivalAt couponCode discountAmount invoiceNumber invoiceIssuedAt pickupVerifiedAt pickupCustomerVerifiedAt readyForPickupAt requiresPickupPreparation requiresReturnConfirmation returnOtpVerifiedAt returnInspection.note returnInspection.inspectedAt returnVerifiedAt cancelledAt cancellationReason handover.pickup.status handover.pickup.sentAt handover.pickup.expiresAt handover.return.status handover.return.sentAt handover.return.expiresAt statusHistory.status statusHistory.previousStatus statusHistory.at payment.status payment.provider payment.method payment.rentalPaid payment.depositHeld payment.depositRefunded payment.paidAt payment.refundedAt payment.adjustments.type payment.adjustments.amount payment.adjustments.note payment.adjustments.createdAt'

export async function customerRentalViews(rentals, { details = false } = {}) {
  const cancellationHours = await cancellationWindowHours()
  const notices =
    details && rentals.length
      ? await Notification.find({
          $or: rentals.map((rental) => ({ requestId: rental._id, userId: rental.customerId })),
        })
          .select('requestId title body link readAt createdAt')
          .sort({ createdAt: -1 })
          .limit(100)
          .lean()
      : []
  const ids = [
    ...new Set(rentals.flatMap((rental) => rental.items.map((item) => String(item.productId)))),
  ]
  const products = await Product.find({ _id: { $in: ids } })
    .select('title category photos location description specifications')
    .lean()
  const byId = new Map(products.map((product) => [String(product._id), product]))
  return rentals.map((rental) => {
    const payment = rental.payment || {}
    const result = {
      _id: rental._id,
      status: rental.status || 'pending',
      createdAt: rental.createdAt,
      updatedAt: rental.updatedAt,
      pickupVerification: pickupWorkflow(rental),
      returnVerification: returnWorkflow(rental),
      readyForPickupAt: rental.readyForPickupAt || null,
      requiresPickupPreparation: Boolean(rental.requiresPickupPreparation),
      returnOtpVerifiedAt: rental.returnOtpVerifiedAt || null,
      returnInspection: rental.returnInspection
        ? { note: rental.returnInspection.note, inspectedAt: rental.returnInspection.inspectedAt }
        : null,
      cancellation: cancellationEligibility(rental, cancellationHours),
      cancelledAt: rental.cancelledAt || null,
      cancellationReason: rental.cancellationReason || '',
      startDate: rental.startDate,
      endDate: rental.endDate,
      addressSnapshot: rental.addressSnapshot || null,
      pickupVerifiedAt: rental.pickupVerifiedAt || null,
      returnVerifiedAt: rental.returnVerifiedAt || null,
      subtotal: rental.subtotal,
      total: rental.total,
      discountAmount: rental.discountAmount || 0,
      couponCode: rental.couponCode || '',
      deliveryMethod: rental.deliveryMethod,
      deliveryWorkflowVersion: rental.deliveryWorkflowVersion,
      deliveryReturnRequestedAt: rental.deliveryReturnRequestedAt || null,
      deliveryFee: rental.deliveryFee || 0,
      invoiceNumber: rental.invoiceNumber || null,
      invoiceIssuedAt: rental.invoiceIssuedAt || null,
      statusHistory: (rental.statusHistory || []).map((event) => ({
        status: event.status,
        previousStatus: event.previousStatus,
        at: event.at,
      })),
      payment: {
        status: payment.status || 'unpaid',
        provider: ['sandbox', 'stripe', 'payhere'].includes(payment.provider)
          ? payment.provider
          : '',
        method: ['card', 'cash', 'bank_transfer', 'wallet'].includes(payment.method)
          ? payment.method
          : null,
        rentalPaid: payment.rentalPaid || 0,
        depositHeld: payment.depositHeld || 0,
        depositRefunded: payment.depositRefunded || 0,
        paidAt: payment.paidAt || null,
        refundedAt: payment.refundedAt || null,
        adjustments: (payment.adjustments || []).map((adjustment) => ({
          type: adjustment.type,
          amount: adjustment.amount,
          note: adjustment.note,
          createdAt: adjustment.createdAt,
        })),
      },
      items: rental.items.map((item) => {
        const product = byId.get(String(item.productId))
        return {
          productId: item.productId,
          title: item.title,
          decision: item.decision,
          decisionReason: item.decisionReason || '',
          // Current booking rules reserve one physical item per unique product ID.
          quantity: 1,
          billingUnit: item.billingUnit || 'day',
          billableHours: item.billableHours,
          dailyRate: item.dailyRate,
          hourlyRate: item.hourlyRate,
          weeklyRate: item.weeklyRate,
          rentalAmount: item.rentalAmount,
          depositAmount: item.depositAmount || 0,
          deliveryStatus: item.deliveryStatus,
          partnerAssigned: Boolean(item.assignedPartner),
          image: product?.photos?.[0] || null,
          category: product?.category || '',
          ...(details
            ? {
                product: product
                  ? {
                      description: product.description,
                      category: product.category,
                      photos: product.photos || [],
                      location: product.location,
                      specifications: (product.specifications || []).map((row) => ({
                        name: row.name,
                        value: row.value,
                      })),
                    }
                  : null,
              }
            : {}),
        }
      }),
    }
    if (details)
      result.notifications = notices
        .filter((notice) => String(notice.requestId) === String(rental._id))
        .map(({ _id, title, body, link, readAt, createdAt }) => ({
          _id,
          title,
          body,
          link,
          readAt,
          createdAt,
        }))
    if (details)
      result.delivery = {
        address: rental.address || '',
        distanceKm: rental.distanceKm || 0,
        etaMinutes: rental.etaMinutes ?? null,
        location: rental.deliveryDestination?.location || null,
        estimatedArrivalAt: rental.estimatedArrivalAt || null,
        quotedAt: rental.deliveryQuotedAt || null,
      }
    return result
  })
}
