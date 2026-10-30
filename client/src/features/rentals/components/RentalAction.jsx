import { Glyph } from './Glyph.jsx'

export function RentalAction({ rental, onVerify }) {
  if (rental.status === 'active' && rental.returnMethod === 'pickup')
    return <span className="handover-waiting">Give your email receipt code to the customer after receiving the items.</span>
  if (rental.returnMethod === 'partner' && ['active', 'return_in_transit'].includes(rental.status))
    return <span className="handover-waiting">Follow the assigned rider in delivery tracking.</span>
  if (rental.status === 'confirmed') {
    if (rental.pickupCompleted) return <span className="handover-waiting">Your shop handover is verified. Remaining shops are pending.</span>
    if (rental.deliveryMethod === 'partner') return <span className="handover-waiting">Follow the shipment handover actions below.</span>
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
    if (
      !['authorized', 'paid'].includes(rental.payment?.status) ||
      !rental.items.every((item) => item.decision === 'accepted')
    )
      return <span className="handover-waiting">Awaiting payment / approval</span>
    return <button className="handover-button primary" onClick={() => onVerify({ rental, type: 'pickup' })}>
      <Glyph name="shield" width="16" /> Send pickup OTP
    </button>
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
  if (rental.status === 'active' && rental.pickupVerifiedAt)
    return <span className="handover-waiting">Waiting for customer return request</span>
  if (rental.status === 'active')
    return <span className="handover-waiting">Historical rental · review required</span>
  return null
}
