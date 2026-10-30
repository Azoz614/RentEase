import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import '../../identity/styles/identity.css'

// Accepting asks for the provider's account password; declining asks for the customer feedback.
export default function RentalDecisionDialog({ target, api, onClose, onDecided }) {
  const accepting = target.decision === 'accepted'
  const dialog = useRef(null),
    [reason, setReason] = useState(''),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [lockedUntil, setLockedUntil] = useState(0)
  useLayoutEffect(() => {
    const node = dialog.current,
      previous = document.activeElement
    node.showModal()
    return () => {
      node.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    if (!lockedUntil) return
    const timer = window.setTimeout(() => setLockedUntil(0), Math.max(0, lockedUntil - Date.now()))
    return () => window.clearTimeout(timer)
  }, [lockedUntil])
  const submit = async (event) => {
    event.preventDefault()
    if (busy || lockedUntil) return
    setBusy(true)
    setError('')
    try {
      const result = await api(
        `/api/provider/requests/${target.requestId}/items/${target.productId}`,
        {
          method: 'PATCH',
          body: JSON.stringify(
            accepting ? { decision: 'accepted', password } : { decision: 'rejected', reason },
          ),
        },
      )
      await onDecided(result.message)
    } catch (failure) {
      setError(failure.message)
      if (accepting) setPassword('')
      if (failure.code === 'APPROVAL_LOCKED' && failure.retryAfter)
        setLockedUntil(Date.now() + failure.retryAfter * 1000)
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="iv-dialog"
      aria-labelledby="rental-decision-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <form onSubmit={submit}>
        <span className="iv-kicker">A CLEAR DECISION, A CLEAR RECORD</span>
        <h2 id="rental-decision-title">{accepting ? 'Accept rental item' : 'Decline rental item'}</h2>
        {accepting ? (
          <p>
            {target.title || 'This item'} will be reserved for the customer. Enter your account
            password to confirm. After 3 incorrect attempts, approvals are locked for 10 minutes.
          </p>
        ) : (
          <p>
            {target.title || 'This item'} will be released from the reservation. The customer
            receives your feedback.
          </p>
        )}
        {accepting ? (
          <label>
            Account password
            <input
              type="password"
              required
              maxLength={128}
              autoComplete="current-password"
              autoFocus
              value={password}
              disabled={Boolean(lockedUntil)}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        ) : (
          <label>
            Reason for declining
            <textarea
              required
              minLength={5}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p className="iv-alert error" role="alert">
            {error}
          </p>
        )}
        <div className="iv-actions">
          <button type="button" className="iv-button secondary" disabled={busy} onClick={onClose}>
            Keep request
          </button>
          <button className="iv-button" disabled={busy || Boolean(lockedUntil)}>
            {busy
              ? 'Recording…'
              : lockedUntil
                ? 'Approvals locked'
                : accepting
                  ? 'Confirm and accept'
                  : 'Decline and notify customer'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
