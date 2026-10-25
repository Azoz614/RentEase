export const deliveryStages = [
  'assigned',
  'heading_to_shop',
  'arrived_at_shop',
  'picked_up',
  'on_the_way',
  'delivered',
  'return_pickup',
  'heading_to_customer',
  'collected',
  'returning',
  'returned',
]
export const activeRental = (rental) =>
  ['confirmed', 'active', 'return_in_transit', 'returned'].includes(rental.status)
export const sharingStage = (item) =>
  item.decision === 'accepted' &&
  Boolean(item.assignedPartner) &&
  deliveryStages.includes(item.deliveryStatus) &&
  !['delivered', 'returned'].includes(item.deliveryStatus)
export const returnStage = (item) =>
  ['return_pickup', 'heading_to_customer', 'collected', 'returning', 'returned'].includes(
    item.deliveryStatus,
  )
export const trackableTask = (rental, item) =>
  rental.deliveryMethod === 'partner' &&
  activeRental(rental) &&
  sharingStage(item) &&
  (rental.status !== 'returned' || returnStage(item))
export function progressBlock(rental, item, status) {
  if (rental.deliveryWorkflowVersion === 2)
    return 'Use the delivery task actions and handover OTP verification.'
  if (!activeRental(rental) || rental.deliveryMethod !== 'partner' || item.decision !== 'accepted')
    return 'Only accepted, active delivery assignments can progress.'
  if (deliveryStages[deliveryStages.indexOf(item.deliveryStatus) + 1] !== status)
    return 'Complete the delivery stages in order.'
  if (
    ['picked_up', 'on_the_way', 'delivered'].includes(status) &&
    (!rental.pickupVerifiedAt || rental.status !== 'active')
  )
    return 'An administrator must verify pickup and confirm handover before the item leaves the shop.'
  if (
    status === 'return_pickup' &&
    !['sent', 'customer_verified', 'verified'].includes(rental.handover?.return?.status) &&
    !rental.returnOtpVerifiedAt &&
    !rental.returnVerifiedAt
  )
    return 'The customer must initiate the return verification workflow first.'
  if (status === 'returned' && !rental.returnVerifiedAt)
    return 'An administrator must verify the return and confirm physical receipt first.'
  if (rental.status === 'returned' && !returnStage({ deliveryStatus: status }))
    return 'This rental has already been returned.'
  return ''
}
