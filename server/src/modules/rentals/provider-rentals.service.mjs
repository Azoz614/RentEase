import { RentalRequest } from './rental.model.mjs'
import { identityError } from '../identity/identity-security.service.mjs'

export async function providerRentalRequests(actor) {
  if (!['admin', 'rental_shop'].includes(actor.role))
    throw identityError(403, 'PROVIDER_REQUIRED', 'Provider access is required.')
  // Administrators oversee every provider, including legacy/orphaned assignments.
  // Shops can only retrieve bookings containing their own items.
  const filter = actor.role === 'admin' ? {} : { 'items.providerId': actor._id }
  const requests = await RentalRequest.find(filter)
    .select('-payment.idempotencyKey -payment.transactionId')
    .populate('customerId', 'username email phone identityStatus')
    .sort({ createdAt: -1, _id: -1 })
    .lean()
  if (actor.role === 'rental_shop') {
    for (const request of requests) {
      request.items = request.items.filter((item) => String(item.providerId) === String(actor._id))
      request.shipments = request.shipments?.filter(
        (shipment) => String(shipment.providerId) === String(actor._id),
      )
    }
  }
  return requests
}
