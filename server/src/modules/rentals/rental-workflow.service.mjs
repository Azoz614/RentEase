export const publicRequest = (request) => (request.toObject ? request.toObject() : request)

export const canManageRequest = (request, user) =>
  user.role === 'admin' ||
  request.items.some((item) => String(item.providerId) === String(user._id))

// Booking-wide actions (cancel, dispute, complete, deposit fees and refunds) affect every
// shop in the booking, so a shop may take them only when it supplies all of the items.
export const controlsWholeRequest = (request, user) =>
  user.role === 'admin' ||
  (request.items.length > 0 &&
    request.items.every((item) => String(item.providerId) === String(user._id)))
export const SHARED_BOOKING_MESSAGE =
  'This booking includes items from other shops. Contact RentEase support to change the whole booking.'

// Once items have been handed over, a booking must be returned, not cancelled.
export const handedOver = (rental) =>
  Boolean(rental.pickupVerifiedAt || rental.returnVerifiedAt) ||
  rental.items?.some((item) => item.pickupVerifiedAt) ||
  (rental.deliveryWorkflowVersion === 2 &&
    rental.items?.some((item) =>
      ['picked_up', 'on_the_way', 'delivered', 'collected', 'returning', 'returned'].includes(
        item.deliveryStatus,
      ),
    ))

export function changeStatus(request, status, user, note = '') {
  const transitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['active', 'cancelled', 'disputed'],
    active: ['returned', 'disputed'],
    return_in_transit: ['disputed'],
    returned: ['completed', 'disputed'],
    completed: [],
    cancelled: [],
    disputed: ['completed', 'cancelled'],
  }
  if (!transitions[request.status || 'pending']?.includes(status))
    throw Object.assign(
      new Error(`This booking cannot move from ${request.status || 'pending'} to ${status}.`),
      { status: 409 },
    )
  request.status = status
  request.statusHistory.push({ status, by: user._id, note })
}
