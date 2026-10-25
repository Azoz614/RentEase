import { formatDate } from '../utils/customerRentalPresentation.js'
import { Symbol } from './Symbol.jsx'

export function RentalProgress({ rental }) {
  const confirmation = rental.statusHistory?.find((event) => event.status === 'confirmed')
  const booked = Boolean(
    confirmation ||
    ['confirmed', 'active', 'return_in_transit', 'returned', 'completed'].includes(rental.status),
  )
  const steps = [
    ['Requested', true, rental.createdAt],
    ['Booked', booked, confirmation?.at],
    [
      rental.deliveryWorkflowVersion === 2 && rental.deliveryMethod === 'partner'
        ? 'Delivery verified'
        : 'Pickup verified',
      Boolean(rental.pickupVerification?.customerVerifiedAt || rental.pickupVerifiedAt),
      rental.pickupVerification?.customerVerifiedAt || rental.pickupVerifiedAt,
    ],
    ['Return verified', Boolean(rental.returnVerifiedAt), rental.returnVerifiedAt],
  ]
  const next = steps.findIndex(([, done]) => !done)
  const stopped = ['cancelled', 'disputed', 'returned', 'completed'].includes(rental.status)
  return (
    <ol className="cr-progress" aria-label="Rental progress">
      {steps.map(([label, done, at], index) => (
        <li
          key={label}
          className={`${done ? 'is-complete' : ''}${index === next && !stopped ? ' is-next' : ''}`}
          aria-current={index === next && !stopped ? 'step' : undefined}
        >
          <span className="cr-progress-dot">
            {done ? <Symbol name="check" size={12} /> : index + 1}
          </span>
          <b>{label}</b>
          <small>{at ? formatDate(at) : done ? 'Confirmed' : stopped ? '—' : 'Pending'}</small>
        </li>
      ))}
    </ol>
  )
}
