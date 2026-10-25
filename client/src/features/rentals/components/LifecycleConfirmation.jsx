import { useState } from 'react'

import { shortId } from '../utils/handoverPresentation.js'
import { Modal } from './Modal.jsx'

export function LifecycleConfirmation({ rental, type, request, onClose, onConfirmed }) {
  const [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const titles = {
    ready: 'Mark rental ready for pickup',
    receipt: 'Confirm return and inspection',
    complete: 'Complete returned rental',
  }
  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/rentals/' +
          rental._id +
          (type === 'receipt' ? '/return/confirm' : type === 'ready' ? '/ready' : '/complete'),
        { method: 'POST', body: JSON.stringify({ inspectionNote: note }) },
      )
      await onConfirmed(result.message)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      titleId="lifecycle-confirm-title"
      onClose={() => {
        if (!busy) onClose()
      }}
      className="handover-details"
    >
      <form onSubmit={submit}>
        <header className="handover-modal-heading">
          <h2 id="lifecycle-confirm-title">{titles[type]}</h2>
        </header>
        <p>
          {rental.items.map((item) => item.title).join(', ')} · {shortId(rental._id)}
        </p>
        <p>
          {type === 'receipt'
            ? 'Only confirm after physically receiving and inspecting the items. Email verification alone does not release inventory.'
            : type === 'ready'
              ? 'Confirm that the paid, approved items are prepared for collection. The customer will be notified.'
              : 'Complete this physically returned booking. Existing payment, deposit and fee records remain unchanged.'}
        </p>
        {type === 'receipt' && (
          <label className="handover-inspection-label">
            Inspection notes
            <textarea
              required
              minLength={5}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="handover-feedback error">
            {error}
          </p>
        )}
        <footer className="handover-modal-actions">
          <button
            type="button"
            className="handover-button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="handover-button primary" disabled={busy}>
            {busy
              ? 'Recording…'
              : type === 'receipt'
                ? 'Confirm receipt and inspection'
                : type === 'ready'
                  ? 'Confirm ready for pickup'
                  : 'Confirm completion'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
