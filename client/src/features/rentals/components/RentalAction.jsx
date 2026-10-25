import { Glyph } from './Glyph.jsx'

export function RentalAction({ rental, onVerify }) {
  if (rental.status === 'confirmed') {
    if (
      rental.requiresPickupPreparation &&
      !rental.readyForPickupAt &&
      ['authorized', 'paid'].includes(rental.payment?.status)
    )
      return (
        <button
          className="handover-button primary"
          onClick={() => onVerify({ rental, type: 'ready' })}
        >
          Mark ready for pickup
        </button>
      )
    if (rental.pickupVerification?.status === 'pending')
      return (
        <button
          className="handover-button primary"
          onClick={() => onVerify({ rental, type: 'pickup' })}
        >
          <Glyph name="shield" width="16" />
          Enter pickup OTP
        </button>
      )
    if (rental.pickupVerification?.status === 'customer_verified')
      return (
        <button
          className="handover-button primary"
          onClick={() => onVerify({ rental, type: 'handover' })}
        >
          <Glyph name="check" width="16" />
          Confirm handover
        </button>
      )
    if (
      !['authorized', 'paid'].includes(rental.payment?.status) ||
      !rental.items.every((item) => item.decision === 'accepted')
    )
      return <span className="handover-waiting">Awaiting payment / approval</span>
    return <span className="handover-waiting">Waiting for customer pickup request</span>
  }
  if (rental.status === 'returned')
    return (
      <button
        className="handover-button secondary"
        onClick={() => onVerify({ rental, type: 'complete' })}
      >
        Complete rental
      </button>
    )
  if (rental.status === 'active' && rental.returnVerification?.status === 'pending')
    return (
      <button
        className="handover-button primary return"
        onClick={() => onVerify({ rental, type: 'return' })}
      >
        <Glyph name="shield" width="16" />
        Enter return OTP
      </button>
    )
  if (rental.status === 'active' && rental.returnOtpVerifiedAt)
    return (
      <button
        className="handover-button primary"
        onClick={() => onVerify({ rental, type: 'receipt' })}
      >
        Confirm return & inspect
      </button>
    )
  if (rental.status === 'active' && rental.pickupVerifiedAt)
    return <span className="handover-waiting">Waiting for customer return request</span>
  if (rental.status === 'active')
    return <span className="handover-waiting">Historical rental · review required</span>
  return null
}
