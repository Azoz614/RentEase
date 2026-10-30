import { RentalRequest } from './rental.model.mjs'
import { identityError } from '../identity/identity-security.service.mjs'

export async function providerRentalRequests(actor) {
  if (!['admin', 'rental_shop'].includes(actor.role))
    throw identityError(403, 'PROVIDER_REQUIRED', 'Provider access is required.')
  // A request goes only to whoever published its items: each shop, and an administrator for
  // the listings it published itself, sees just its own items in a booking.
  const requests = await RentalRequest.find({ 'items.providerId': actor._id })
    .select('-payment.idempotencyKey -payment.transactionId')
    // Shops talk to customers through RentEase chat, so they get no customer contact details.
    .populate('customerId', actor.role === 'admin' ? 'username email phone identityStatus' : 'username identityStatus')
    .sort({ createdAt: -1, _id: -1 })
    .lean()
  for (const request of requests) {
    request.items = request.items.filter((item) => String(item.providerId) === String(actor._id))
    request.shipments = request.shipments?.filter(
      (shipment) => String(shipment.providerId) === String(actor._id),
    )
  }
  return requests
}
