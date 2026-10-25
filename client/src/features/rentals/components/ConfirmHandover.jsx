import { useRef, useState } from 'react'

import { shortId } from '../utils/handoverPresentation.js'
import { Modal } from './Modal.jsx'

export function ConfirmHandover({ rental, request, onClose, onConfirmed }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const inFlight = useRef(false)
  const confirm = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      const result = await request('/rentals/' + rental._id + '/handover/confirm', {
        method: 'POST',
        body: '{}',
      })
      await onConfirmed(result.message)
    } catch (failure) {
      setError(failure.message)
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <Modal
      titleId="confirm-handover-title"
      onClose={() => {
        if (!busy) onClose()
      }}
      className="handover-details"
    >
      <header className="handover-modal-heading">
        <div>
          <span className="handover-eyebrow">CUSTOMER EMAIL VERIFIED</span>
          <h2 id="confirm-handover-title">Confirm physical handover</h2>
        </div>
      </header>
      <p>
        <b>{rental.customerId?.username}</b> · {shortId(rental._id)}
      </p>
      <p>{rental.items.map((item) => item.title).join(', ')}</p>
      <p>
        Only confirm after the customer has physically received the items. This records you as the
        handing-over administrator and starts the rental.
      </p>
      {error && (
        <p className="handover-feedback error" role="alert">
          {error}
        </p>
      )}
      <footer className="handover-modal-actions">
        <button className="handover-button secondary" disabled={busy} onClick={onClose}>
          Not handed over yet
        </button>
        <button className="handover-button primary" disabled={busy} onClick={confirm}>
          {busy ? 'Confirming…' : 'Confirm items handed over'}
        </button>
      </footer>
    </Modal>
  )
}
