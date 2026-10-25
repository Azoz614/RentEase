import { formatCurrency as money } from '../../../utils/currency.js'
import { useEffect, useId, useRef, useState } from 'react'

import { shortId, formatDate, depositFor } from '../utils/customerRentalPresentation.js'

import { Symbol } from './Symbol.jsx'

export function ActionDialog({ action, busy, error, onConfirm, onClose }) {
  const dialog = useRef(null)
  const titleId = useId()
  const isPayment = action.type === 'pay'
  const [reason, setReason] = useState('')
  const rental = action.rental
  useEffect(() => {
    const previous = document.activeElement
    const element = dialog.current
    element.showModal()
    return () => {
      element.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="cr-action-dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <button
        className="cr-dialog-close"
        aria-label="Close booking action"
        disabled={busy}
        onClick={onClose}
      >
        <Symbol name="close" size={19} />
      </button>
      <span className={`cr-dialog-icon${isPayment ? '' : ' cr-danger-icon'}`}>
        <Symbol name={isPayment ? 'receipt' : 'calendar'} size={28} />
      </span>
      <span className="cr-eyebrow">{shortId(rental._id)}</span>
      <h2 id={titleId}>{isPayment ? 'Ready for your next plan?' : 'Cancel this booking?'}</h2>
      <p>
        {isPayment
          ? 'Review the rental charge and refundable deposit before confirming.'
          : 'Your reserved items will be released if this cancellation is accepted.'}
      </p>
      {isPayment ? (
        <>
          <div className="cr-dialog-breakdown">
            <div>
              <span>Rental & booked delivery</span>
              <b>{money(rental.total)}</b>
            </div>
            <div>
              <span>Refundable security deposit</span>
              <b>{money(depositFor(rental))}</b>
            </div>
            <div>
              <span>Total to record</span>
              <strong>{money(Number(rental.total || 0) + depositFor(rental))}</strong>
            </div>
          </div>
          <div className="cr-sandbox-note">
            <Symbol name="shield" size={19} />
            <span>
              <b>Test checkout</b>Sandbox payments are enabled. No real money will be charged.
            </span>
          </div>
        </>
      ) : (
        <>
          <div className="cr-cancel-note">
            <b>{rental.items.map((item) => item.title).join(', ')}</b>
            <p>
              {formatDate(rental.startDate, true)} – {formatDate(rental.endDate, true)} ·{' '}
              {money(rental.total)}
            </p>
            Reserved items will be released and pending verification codes invalidated. Cancellation
            eligibility is checked when you confirm. Any sandbox deposit release is recorded; no
            real-money refund is processed here.
            {rental.cancellation?.cutoffAt && (
              <p>Cancel before {formatDate(rental.cancellation.cutoffAt, true)}.</p>
            )}
          </div>
          <label className="cr-cancel-reason">
            Reason (optional)
            <textarea
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          </label>
        </>
      )}
      {error && (
        <p className="cr-dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="cr-dialog-actions">
        <button
          className={`cr-button ${isPayment ? 'cr-primary' : 'cr-danger'}`}
          disabled={busy}
          onClick={() => onConfirm(reason)}
        >
          {busy && <span className="cr-spinner" />}
          {busy ? 'Please wait…' : isPayment ? 'Confirm test payment' : 'Yes, cancel booking'}
        </button>
        <button className="cr-button cr-secondary" disabled={busy} onClick={onClose} autoFocus>
          {isPayment ? 'Not right now' : 'Keep my booking'}
        </button>
      </div>
    </dialog>
  )
}
