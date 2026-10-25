export const shortId = (value) => `RE-${String(value).slice(-8).toUpperCase()}`

export const formatDate = (value, includeTime = false) => {
  if (!value || !Number.isFinite(new Date(value).getTime())) return 'Not recorded'
  return new Date(value).toLocaleString('en-LK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export const hasPayment = (rental) =>
  Boolean(
    rental.payment?.paidAt ||
    ['authorized', 'paid', 'refunded', 'partially_refunded'].includes(rental.payment?.status),
  )

export const depositFor = (rental) =>
  rental.items.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0)

export const canPay = (rental) =>
  rental.status === 'confirmed' &&
  rental.payment?.status === 'unpaid' &&
  rental.items.length > 0 &&
  rental.items.every((item) => item.decision === 'accepted')

export const maskEmail = (email) => {
  const [name, domain] = String(email || '').split('@')
  return domain ? `${name.slice(0, 1)}***@${domain}` : 'your registered email'
}

export const filters = [
  ['all', 'All rentals'],
  ['upcoming', 'Upcoming'],
  ['active', 'On rental'],
  ['past', 'Past rentals'],
]

export const isUpcoming = (rental) => ['pending', 'confirmed'].includes(rental.status || 'pending')

export const isPast = (rental) => ['returned', 'completed', 'cancelled'].includes(rental.status)

export function nextStep(rental) {
  if (
    rental.deliveryWorkflowVersion === 2 &&
    rental.deliveryMethod === 'partner' &&
    ['confirmed', 'active', 'return_in_transit'].includes(rental.status) &&
    !canPay(rental)
  )
    return {
      title:
        rental.status === 'return_in_transit'
          ? 'Your return is on the way'
          : rental.deliveryReturnRequestedAt
            ? 'Return collection requested'
            : rental.status === 'active'
              ? 'Your rental is with you'
              : 'Your delivery is being arranged',
      description:
        'Follow delivery tracking below. Each collection, delivery and shop return is secured by a separate email code.',
      icon: 'box',
      tone: 'blue',
    }
  if (rental.status === 'cancelled')
    return {
      title: 'This booking was cancelled',
      description: 'You can find any recorded deposit release in the payment details below.',
      icon: 'box',
      tone: 'muted',
    }
  if (rental.status === 'disputed')
    return {
      title: 'Your rental is being reviewed',
      description: 'Check your mailbox for updates from the team about this booking.',
      icon: 'mail',
      tone: 'amber',
    }
  if (rental.returnVerifiedAt)
    return {
      title: 'Return verified. Thank you!',
      description:
        'Your items have been checked back in. Deposit adjustments and refunds are shown in your payment details.',
      icon: 'check',
      tone: 'green',
    }
  if (['returned', 'completed'].includes(rental.status))
    return {
      title: 'Your rental has ended',
      description:
        'Your rental is marked as returned. Open booking details to review the recorded history.',
      icon: 'check',
      tone: 'green',
    }
  if (rental.status === 'active' && rental.returnOtpVerifiedAt)
    return {
      title: 'Return code verified. Inspection next.',
      description:
        'The administrator must confirm physical receipt and inspect your items before the rental is marked returned.',
      icon: 'shield',
      tone: 'blue',
    }
  if (rental.status === 'active')
    return {
      title: 'Enjoy your rental',
      description:
        'Choose self return or rider collection. For self return, ask the shop for its email receipt code and verify it here.',
      icon: 'box',
      tone: 'blue',
    }
  if (rental.status === 'confirmed' && rental.pickupVerification?.status === 'customer_verified')
    return {
      title: 'Email verified. Handover next.',
      description:
        'Meet the administrator to collect your items. Your rental starts only when they confirm the physical handover.',
      icon: 'check',
      tone: 'green',
    }
  if (canPay(rental))
    return {
      title: 'One step before pickup',
      description: 'Review your rental payment and refundable deposit to get ready for collection.',
      icon: 'receipt',
      tone: 'amber',
    }
  if (
    rental.status === 'confirmed' &&
    rental.requiresPickupPreparation &&
    !rental.readyForPickupAt &&
    hasPayment(rental)
  )
    return {
      title: 'Your items are being prepared',
      description: 'We will notify you when an administrator marks your rental ready for pickup.',
      icon: 'box',
      tone: 'blue',
    }
  if (rental.status === 'confirmed' && hasPayment(rental))
    return {
      title: 'You’re ready for pickup',
      description:
        'Verify your email below. An administrator can also email you a six-digit pickup code at collection and confirm the physical handover.',
      icon: 'shield',
      tone: 'blue',
    }
  if (rental.items.some((item) => item.decision === 'rejected'))
    return {
      title: 'An item needs your attention',
      description:
        'Some items were declined. Review the item decisions below and contact the team before making plans.',
      icon: 'mail',
      tone: 'amber',
    }
  return {
    title: 'Your request is with the team',
    description:
      'We’ll review your items and confirm availability. Payment opens after every item is accepted.',
    icon: 'calendar',
    tone: 'muted',
  }
}
