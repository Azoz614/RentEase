import { useEffect, useId, useRef, useState } from 'react'
import { canCustomerPickup } from '../utils/customerRental.js'
import '../styles/customer-pickup.css'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'

export function PickupSection({ rental, onVerify, busy }) {
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
      <h3>{pending ? 'Show your code to an administrator' : 'Ready for pickup?'}</h3>
      <p>
        {pending
          ? 'A pickup code was sent to your registered email. Give the code to an administrator, who will verify it and start your rental.'
          : eligible
            ? `Your items are approved and payment is recorded. Pickup is scheduled from ${new Date(rental.startDate).toLocaleString('en-LK')}.`
            : preparing
              ? 'The administrator is preparing your approved items. You will be notified when pickup is ready.'
              : 'Pickup is available after all items are accepted and payment is recorded.'}
      </p>
      {eligible && (
        <button
          className="cr-button cr-primary"
          disabled={Boolean(busy) || pending}
          onClick={() => onVerify(rental)}
        >
          {pending ? 'Pickup request pending' : 'Pickup'}
        </button>
      )}
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

export default function CustomerPickupModal({ rental, api, onClose, onRequested }) {
  const dialog = useRef(null),
    mounted = useRef(false),
    started = useRef(false),
    closeTimer = useRef(null)
  const titleId = useId(),
    hintId = useId()
  const [busy, setBusy] = useState(true),
    [result, setResult] = useState(null),
    [error, setError] = useState(''),
    [closing, setClosing] = useState(false)
  const stopped = rental.status !== 'confirmed'
  const send = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await api(`/api/requests/${rental._id}/pickup/send`, {
        method: 'POST',
        body: '{}',
      })
      if (!mounted.current) return
      setResult(response)
      onRequested?.(
        response.message || 'Pickup code sent. Give it to an administrator for verification.',
      )
    } catch (failure) {
      if (mounted.current)
        setError(failure.message || 'We could not send a pickup code. Please try again.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  useEffect(() => {
    const element = dialog.current,
      previous = document.activeElement
    element.showModal()
    return () => {
      clearTimeout(closeTimer.current)
      element.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    if (!started.current && !stopped) {
      started.current = true
      send()
    }
    return () => {
      mounted.current = false
    }
  }, [])
  const dismiss = () => {
    if (busy || closing) return
    setClosing(true)
    closeTimer.current = setTimeout(onClose, 150)
  }
  return (
    <dialog
      ref={dialog}
      className={`cr-action-dialog cr-otp-dialog${closing ? ' is-closing' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onCancel={(event) => {
        event.preventDefault()
        dismiss()
      }}
    >
      <button
        className="cr-dialog-close"
        disabled={busy}
        aria-label="Close pickup request"
        onClick={dismiss}
      >
        ×
      </button>
      <span className={`cr-otp-emblem${result ? ' is-success' : ''}`} aria-hidden="true">
        <UiIcon name={result ? 'check' : 'mail'} size={29} />
      </span>
      <span className="cr-eyebrow">PICKUP VERIFICATION</span>
      <h2 id={titleId}>
        {stopped
          ? 'Pickup is unavailable'
          : result
            ? 'Pickup code sent'
            : 'Sending your pickup code'}
      </h2>
      <p id={hintId}>
        {stopped ? (
          'This booking changed. Pickup codes cannot be requested.'
        ) : result ? (
          <>
            A six-digit code was sent to <b>{result.maskedEmail}</b>. Show the code to an
            administrator; only the administrator can enter and verify it.
          </>
        ) : (
          'We are sending a six-digit code to your registered email.'
        )}
      </p>
      <div className="cr-otp-booking">
        <b>{rental.items[0]?.title}</b>
        <small>
          RE-{rental._id.slice(-8).toUpperCase()} · {rental.items.length} item(s)
        </small>
      </div>
      {error && (
        <p className="cr-dialog-error" role="alert">
          {error}
        </p>
      )}
      {!result && !stopped && (
        <button className="cr-button cr-primary cr-otp-submit" disabled={busy} onClick={send}>
          {busy ? 'Sending code…' : 'Try again'}
        </button>
      )}
      <button className="cr-button cr-secondary cr-otp-submit" disabled={busy} onClick={dismiss}>
        {result || stopped ? 'Back to rentals' : 'Cancel'}
      </button>
    </dialog>
  )
}
