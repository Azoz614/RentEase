import { canCustomerPickup } from '../utils/customerRental.js'
import '../styles/customer-pickup.css'

export function PickupSection({ rental }) {
  if (
    rental.status !== 'confirmed' ||
    (rental.deliveryMethod === 'partner' && rental.deliveryWorkflowVersion === 2)
  )
    return null
  const preparing = rental.requiresPickupPreparation && !rental.readyForPickupAt
  const eligible = canCustomerPickup(rental)
  const pending = rental.pickupVerification?.status === 'pending'
  return (
    <section
      className={`cr-pickup-section${pending ? ' is-verified' : ''}`}
      aria-label="Customer pickup request"
    >
      <span className="cr-eyebrow">
        {pending ? 'PICKUP REQUEST PENDING' : 'BEFORE YOUR HANDOVER'}
      </span>
      <h3>{pending ? 'Share your receipt code with the shop' : 'Ready for pickup?'}</h3>
      <p>
        {pending
          ? 'The shop sent a code to your email and private inbox. Share it with the shop after receiving your items; verification starts your rental.'
          : eligible
            ? `Meet the shop to receive your items. The shop sends and verifies your receipt code. Pickup is scheduled from ${new Date(rental.startDate).toLocaleString('en-LK')}.`
            : preparing
              ? 'The administrator is preparing your approved items. You will be notified when pickup is ready.'
              : 'Pickup is available after all items are accepted and payment is recorded.'}
      </p>
    </section>
  )
}

export function CancellationRecord({ rental }) {
  if (rental.status !== 'cancelled') return null
  return (
    <section className="cr-cancellation-record" aria-label="Cancellation record">
      <b>Cancelled booking</b>
      <p>
        {rental.cancelledAt
          ? new Date(rental.cancelledAt).toLocaleString('en-LK')
          : 'Cancellation time not recorded'}
      </p>
      {rental.cancellationReason && <p>Reason: {rental.cancellationReason}</p>}
      <small>
        Pickup and return verification are unavailable. This booking remains in your rental history.
      </small>
    </section>
  )
}
