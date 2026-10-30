import { useState } from 'react'
import { formatCurrency as money } from '../../../utils/currency.js'

const feeLabels = { late_fee: 'Late fee', damage_fee: 'Damage fee', return_collection: 'Return collection' }

// Records late/damage fees against the held deposit and releases the rest to the customer.
// The server enforces the same rules; this only offers the actions that can succeed.
export function DepositSettlement({ rental, request, onUpdated }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmRelease, setConfirmRelease] = useState(false)
  const payment = rental.payment || {}
  if (rental.shared || payment.status !== 'authorized' || !Number(payment.depositHeld)) return null
  const fees = payment.adjustments || []
  const remaining = Math.max(0, Number(payment.depositHeld) - fees.reduce((sum, fee) => sum + Number(fee.amount || 0), 0))
  const canCharge = ['active', 'returned', 'disputed'].includes(rental.status) && remaining > 0
  const canRelease = ['returned', 'completed'].includes(rental.status)
  const run = async (path, body, success) => {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await request(`/api/provider/requests/${rental._id}/${path}`, { method: 'POST', body: JSON.stringify(body) })
      setNotice(result.message || success)
      setConfirmRelease(false)
      await onUpdated()
      return true
    } catch (failure) {
      setError(failure.message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const charge = async (event) => {
    event.preventDefault()
    const form = event.currentTarget, data = new FormData(form)
    const ok = await run('adjustments', { type: data.get('type'), amount: Number(data.get('amount')), note: String(data.get('note')).trim() }, 'Fee recorded.')
    if (ok) form.reset()
  }
  return (
    <section className="deposit-settlement" aria-labelledby="deposit-settlement-title">
      <h3 id="deposit-settlement-title">Security deposit</h3>
      <dl>
        <div><dt>Held</dt><dd>{money(payment.depositHeld)}</dd></div>
        {fees.map((fee, index) => (
          <div key={`${fee.type}-${index}`}><dt>{feeLabels[fee.type] || 'Fee'}{fee.note ? ` · ${fee.note}` : ''}</dt><dd>−{money(fee.amount)}</dd></div>
        ))}
        <div className="deposit-remaining"><dt>Remaining</dt><dd>{money(remaining)}</dd></div>
      </dl>
      {canCharge && (
        <form className="deposit-fee-form" onSubmit={charge}>
          <label>Fee type
            <select name="type" disabled={busy}><option value="late_fee">Late fee</option><option value="damage_fee">Damage fee</option></select>
          </label>
          <label>Amount (LKR)
            <input name="amount" type="number" min="1" max={remaining} step="1" required disabled={busy} />
          </label>
          <label className="deposit-fee-note">Reason shown to the customer
            <input name="note" required minLength={3} maxLength={500} disabled={busy} placeholder="e.g. Returned one day late" />
          </label>
          <button className="handover-button secondary" disabled={busy}>Record fee</button>
        </form>
      )}
      {canRelease && (
        confirmRelease ? (
          <div className="deposit-confirm" role="group" aria-label="Confirm deposit release">
            <p>Release {money(remaining)} to the customer? Fees can’t be added afterwards.</p>
            <button className="handover-button primary" disabled={busy} onClick={() => run('deposit/refund', {}, 'Deposit released.')}>
              {busy ? 'Releasing…' : `Release ${money(remaining)}`}
            </button>
            <button className="handover-button secondary" disabled={busy} onClick={() => setConfirmRelease(false)}>Cancel</button>
          </div>
        ) : (
          <button className="handover-button primary" disabled={busy} onClick={() => setConfirmRelease(true)}>Release deposit</button>
        )
      )}
      {!canRelease && <p className="deposit-hint">You can release the deposit once the return is verified.</p>}
      {error && <p role="alert" className="handover-feedback error">{error}</p>}
      {notice && <p role="status" className="handover-feedback">{notice}</p>}
    </section>
  )
}
