import { useLayoutEffect, useRef, useState } from 'react'
import '../../identity/styles/identity.css'

export default function RentalDecisionDialog({ target, api, onClose, onDecided }) {
  const dialog = useRef(null),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useLayoutEffect(() => {
    const node = dialog.current,
      previous = document.activeElement
    node.showModal()
    return () => {
      node.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api(
        `/api/provider/requests/${target.requestId}/items/${target.productId}`,
        { method: 'PATCH', body: JSON.stringify({ decision: 'rejected', reason }) },
      )
      await onDecided(result.message)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="iv-dialog"
      aria-labelledby="rental-decline-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <form onSubmit={submit}>
        <span className="iv-kicker">A CLEAR DECISION, A CLEAR RECORD</span>
        <h2 id="rental-decline-title">Decline rental item</h2>
        <p>
          {target.title || 'This item'} will be released from the reservation. The customer receives
          your feedback.
        </p>
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
        {error && (
          <p className="iv-alert error" role="alert">
            {error}
          </p>
        )}
        <div className="iv-actions">
          <button type="button" className="iv-button secondary" disabled={busy} onClick={onClose}>
            Keep request
          </button>
          <button className="iv-button" disabled={busy}>
            {busy ? 'Recording…' : 'Decline and notify customer'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
