import { RentalRequest } from '../rentals/rental.model.mjs'
import { User } from '../users/user.model.mjs'

// Listings are only shown while their provider can take bookings: suspended, demoted or
// unapproved shops keep their listings, hidden, until they are reinstated.
export async function bookableProviders() {
  const ids = await User.distinct('_id', {
    active: true,
    $or: [{ role: 'admin' }, { role: 'rental_shop', shopStatus: 'approved' }],
  })
  return { providerId: { $in: ids } }
}

const overlaps = (booking, start, end) =>
  Boolean(start && end && new Date(booking.startDate) < end && new Date(booking.endDate) > start)
const released = new Set(['cancelled', 'returned', 'completed'])

// Booking lifecycle is authoritative. A cancelled booking's legacy slot must not lock inventory.
// Unknown slots remain conservative holds; do not silently discard a reservation without evidence.
export async function inventoryAvailability(
  products,
  start = null,
  end = null,
  excludeRequestId = null,
) {
  const ids = products.map((product) => product._id)
  if (!ids.length) return new Map()
  const rentals = await RentalRequest.find({ 'items.productId': { $in: ids } })
    .select(
      '_id items.productId items.decision items.deliveryStatus status startDate endDate pickupVerifiedAt returnVerifiedAt',
    )
    .lean()
  return new Map(
    products.map((product) => {
      const productId = String(product._id)
      const related = rentals.filter((rental) =>
        rental.items.some((item) => String(item.productId) === productId),
      )
      const ignoredRequestIds = related
        .filter(
          (rental) =>
            released.has(rental.status) ||
            rental.items
              .filter((item) => String(item.productId) === productId)
              .every((item) => item.decision === 'rejected'),
        )
        .map((rental) => rental._id)
      const ignored = new Set(ignoredRequestIds.map(String))
      if (excludeRequestId) ignored.add(String(excludeRequestId))
      const holding = related.filter((rental) => !ignored.has(String(rental._id)))
      const onRental = holding.some(
        (rental) =>
          ['active', 'return_in_transit'].includes(rental.status) ||
          (['confirmed', 'disputed'].includes(rental.status) &&
            rental.items.some(
              (i) =>
                String(i.productId) === productId &&
                ['picked_up', 'on_the_way', 'delivered'].includes(i.deliveryStatus),
            )) ||
          (rental.status === 'disputed' && rental.pickupVerifiedAt && !rental.returnVerifiedAt),
      )
      const booked =
        holding.some((rental) => overlaps(rental, start, end)) ||
        (product.rentalSlots || []).some(
          (slot) => !ignored.has(String(slot.requestId)) && overlaps(slot, start, end),
        )
      const state = onRental ? 'on_rental' : booked ? 'booked' : 'available'
      return [productId, { available: !onRental && !booked, state, ignoredRequestIds }]
    }),
  )
}

export function availabilityView(entry) {
  return { available: entry.available, availabilityStatus: entry.state }
}
