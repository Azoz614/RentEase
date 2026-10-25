import { useEffect, useId, useRef, useState } from 'react'
import { Modal } from './Modal.jsx'
import { LocationPicker } from '../../maps/components/LocationPicker.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { formatCurrencyFixed as money } from '../../../utils/currency.js'
import '../../delivery-partner/styles/delivery-dispatch.css'
import '../styles/rental-handover.css'

export default function ReturnMethodDialog({ rental, api, onClose, onUpdated }) {
  const titleId = useId()
  const [method, setMethod] = useState(rental.returnMethod || '')
  const [collection, setCollection] = useState(rental.deliveryDestination || rental.delivery?.destination || {})
  const [quote, setQuote] = useState(null)
  const [handovers, setHandovers] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const inFlight = useRef(false)
  const base = '/api/delivery/rentals/' + rental._id
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (method !== 'pickup') return
    const controller = new AbortController()
    api(base + '/self-return', { signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted) setHandovers(result.handovers)
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [api, base, method])
  const perform = async (path, body, after) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api(base + path, { method: 'POST', body: JSON.stringify(body) })
      if (result.handovers) setHandovers(result.handovers)
      setNotice(result.message || '')
      await after?.(result)
    } catch (failure) {
      setError(failure.message)
      if (path === '/self-return/send') {
        try { setHandovers((await api(base + '/self-return')).handovers) } catch { /* Keep the last receipt state available. */ }
      }
    }
    finally { inFlight.current = false; setBusy(false) }
  }
  const update = async (result) => {
    await onUpdated?.(result.message)
    window.dispatchEvent(new Event('rentease:delivery'))
    if (result.returned || method === 'partner') onClose()
    else setHandovers((await api(base + '/self-return')).handovers)
  }
  return (
    <Modal titleId={titleId} className="return-method-dialog" onClose={() => { if (!busy) onClose() }}>
      <div className="dispatch-board">
        <header className="dispatch-heading">
          <div><span className="workspace-kicker">A SAFE JOURNEY BACK</span><h2 id={titleId}>Return your rental</h2>
            <p>Choose how your items get back to the shop.</p></div>
          <button type="button" aria-label="Close return options" disabled={busy} onClick={onClose}><UiIcon name="close" size={18} /></button>
        </header>
        <div className="dispatch-methods" role="group" aria-label="Return method">
          {[['pickup', 'Self return', 'Bring your items to the shop. Verify its receipt code.', 'box'],
            ['partner', 'Delivery partner', 'A nearby rider collects and returns your items.', 'truck']].map(([value, label, description, icon]) => (
            <button key={value} type="button" className={method === value ? 'is-selected' : ''}
              aria-label={label} aria-describedby={`${titleId}-${value}`} aria-pressed={method === value} disabled={busy || Boolean(rental.returnMethod && rental.returnMethod !== value) || handovers.some((h) => h.status !== 'not_started') && value !== 'pickup'}
              onClick={() => { setMethod(value); setError(''); setQuote(null) }}>
              <UiIcon name={icon} size={26} /><b>{label}</b><small id={`${titleId}-${value}`}>{description}</small>
            </button>
          ))}
        </div>
        {error && <p className="re-map-error" role="alert">{error}</p>}
        {notice && <p className="dispatch-notice" role="status">{notice}</p>}
        {method === 'pickup' && <section aria-label="Shop receipt verification">
          <p className="dispatch-hint">The code goes to the shop’s registered email. Ask the shop for it after handing over your items, then enter it here. Each shop confirms its own items.</p>
          {!handovers.length && <p role="status" className="dispatch-loading">Loading responsible shops…</p>}
          {handovers.map((h) => {
            const remaining = Math.max(0, Math.ceil((new Date(h.expiresAt).getTime() - now) / 1000))
            const cooldown = Math.max(0, Math.ceil((new Date(h.resendAt).getTime() - now) / 1000))
            return <article key={h.providerId} className="dispatch-challenge">
              <h3>{h.name}</h3>
              {h.status === 'verified' ? <p className="dispatch-notice"><UiIcon name="check" size={18} /> Receipt verified</p> : <>
                {h.status === 'sent' && <p role="status">Sent to {h.maskedEmail} · {remaining > 0 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} remaining` : 'Code expired'}</p>}
                <button disabled={busy || cooldown > 0} onClick={() => perform('/self-return/send', { providerId: h.providerId })}>
                  {cooldown > 0 ? `Resend in ${cooldown}s` : h.challengeId ? 'Send a new shop code' : 'Send code to shop'}</button>
                {h.status === 'sent' && remaining > 0 && <form key={h.challengeId} onSubmit={(event) => {
                  event.preventDefault()
                  perform('/self-return/verify', { challengeId: h.challengeId, code: new FormData(event.currentTarget).get('code') }, update)
                }}>
                  <label>Shop receipt code<input name="code" aria-label={`Receipt code from ${h.name}`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" disabled={busy} /></label>
                  <button className="dispatch-primary" disabled={busy}>{busy ? 'Verifying…' : 'Verify return receipt'}</button>
                </form>}
              </>}
            </article>
          })}
        </section>}
        {method === 'partner' && <section aria-label="Return collection location">
          <h3>Where should your rider collect?</h3>
          <LocationPicker value={collection} onChange={(value) => { setCollection(value); setQuote(null) }} />
          <button disabled={busy || !collection.location || !collection.address} onClick={() => perform('/return/quote', { collection }, setQuote)}>
            {busy ? 'Calculating driving route…' : quote ? 'Refresh collection route' : 'Review collection route'}</button>
          {quote && <div className="dispatch-return-quote">
            {quote.shipments.map((s) => <div key={s.providerId}><span>{s.shopName}</span><b>{s.returnDistanceKm.toFixed(2)} km · {s.returnEtaMinutes} min</b></div>)}
            <div><span>Return fee {quote.fee ? '(included in booking)' : '(waived)'}</span><b>{money(quote.fee)}</b></div>
            <p>Nearby riders receive your request first. Both handovers require separate email codes.</p>
            <button className="dispatch-primary" disabled={busy || quote.expiresAt <= now} onClick={() => perform('/return', { quoteToken: quote.quoteToken }, update)}>
              {quote.expiresAt <= now ? 'Route expired · refresh above' : busy ? 'Requesting collection…' : 'Confirm & find a return rider'}</button>
          </div>}
        </section>}
      </div>
    </Modal>
  )
}
