const labels = {
  pending: 'Under review',
  confirmed: 'Booked',
  active: 'Renting',
  return_in_transit: 'Return in transit',
  returned: 'Returned',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Under review',
}

export const hasRentalPayment = (rental) =>
  Boolean(
    rental.payment?.paidAt ||
    ['authorized', 'paid', 'refunded', 'partially_refunded'].includes(rental.payment?.status),
  )
export function customerRentalStatus(rental) {
  if (rental.status === 'active' && rental.deliveryReturnRequestedAt) return 'Return collection requested'
  if (rental.status === 'active' && rental.returnMethod === 'pickup') return 'Self return in progress'
  if (rental.deliveryWorkflowVersion === 2 && rental.deliveryMethod === 'partner') {
    if (rental.status === 'confirmed') return 'Awaiting delivery'
    if (rental.status === 'active' && rental.deliveryReturnRequestedAt)
      return 'Return collection requested'
  }
  if (rental.status === 'active' && rental.returnVerification?.status === 'pending')
    return 'Return verification pending'
  if (rental.status === 'active' && rental.returnOtpVerifiedAt)
    return 'Return verified · inspection pending'
  if (rental.status === 'confirmed') {
    if (rental.pickupVerification?.status === 'customer_verified')
      return 'Pickup verified · awaiting handover'
    if (rental.requiresPickupPreparation && !rental.readyForPickupAt && hasRentalPayment(rental))
      return 'Preparing pickup'
    if (rental.pickupVerification?.status === 'pending') return 'Pickup verification pending'
    if (rental.readyForPickupAt) return 'Ready for pickup'
    if (hasRentalPayment(rental) && !rental.pickupVerifiedAt) return 'Awaiting pickup'
  }
  return labels[rental.status] || 'Under review'
}

export const canCustomerPickup = (rental) =>
  !(rental.deliveryWorkflowVersion === 2 && rental.deliveryMethod === 'partner') &&
  rental.status === 'confirmed' &&
  (!rental.requiresPickupPreparation || Boolean(rental.readyForPickupAt)) &&
  ['authorized', 'paid'].includes(rental.payment?.status) &&
  rental.items.length > 0 &&
  rental.items.every((item) => item.decision === 'accepted') &&
  !rental.pickupVerifiedAt &&
  rental.pickupVerification?.status !== 'customer_verified'
export const canCancelRental = (rental) =>
  ['pending', 'confirmed'].includes(rental.status) && rental.cancellation?.allowed !== false

// A slow list/detail poll must not roll back a more recent handover response.
export function preferLatestRental(current, incoming) {
  const previousTime = new Date(current?.updatedAt).getTime()
  const incomingTime = new Date(incoming?.updatedAt).getTime()
  return Number.isFinite(previousTime) &&
    Number.isFinite(incomingTime) &&
    incomingTime < previousTime
    ? current
    : incoming
}
