import { useCallback, useEffect, useRef, useState } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import '../styles/commissions.css'

const money = (minor = 0) => new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(minor / 100)
export default function CommissionPanel({ api, role = 'admin' }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ kind: '', status: '', from: '', to: '', page: 1 })
  const sequence = useRef(0)
  const load = useCallback(async () => {
    const version = ++sequence.current; setLoading(true)
    try {
      const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ''))
      const result = await api(`/api/commissions?${query}`)
      if (version === sequence.current) { setData(result); setError('') }
    } catch (failure) { if (version === sequence.current) setError(failure.message) }
    finally { if (version === sequence.current) setLoading(false) }
  }, [api, filters])
  useEffect(() => {
    queueMicrotask(load)
    const refresh = () => { if (document.visibilityState !== 'hidden') load() }
    const timer = setInterval(refresh, 30000)
    window.addEventListener('focus', refresh); window.addEventListener('rentease:delivery', refresh)
    return () => { sequence.current += 1; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('rentease:delivery', refresh) }
  }, [load])
  const update = (event) => setFilters((current) => ({ ...current, [event.target.name]: event.target.value, page: 1 }))
  const rental = data?.rental || {}, delivery = data?.delivery || {}
  const cards = role === 'admin' ? [
    ['Eligible rental revenue', rental.grossMinor, 'Rental subtotal after discounts'],
    ['Rental commission earned', rental.earnedMinor, '5% · excludes delivery and deposits'],
    ['Eligible delivery revenue', delivery.grossMinor, 'Verified outbound and return deliveries'],
    ['Delivery commission earned', delivery.earnedMinor, '1% · one allocation per completed trip'],
    ['Total commission earned', (rental.earnedMinor || 0) + (delivery.earnedMinor || 0), 'Earned allocations including recorded settlements'],
    ['Pending settlement', (rental.pendingMinor || 0) + (delivery.pendingMinor || 0), 'Allocated amounts awaiting settlement'],
    ['Settled commission', (rental.settledMinor || 0) + (delivery.settledMinor || 0), 'Only confirmed external settlements'],
  ] : [
    ['Gross revenue allocated', (rental.grossMinor || 0) + (delivery.grossMinor || 0), 'After refunds and rental discounts'],
    ['Organization commission', (rental.commissionMinor || 0) + (delivery.commissionMinor || 0), role === 'rental_shop' ? '5% of eligible rental revenue' : '1% of eligible delivery revenue'],
    ['Your net allocation', (rental.netMinor || 0) + (delivery.netMinor || 0), 'Gross allocation less organization commission'],
  ]
  return <section className="commission-panel" aria-label="Commission and earnings report">
    <header className="cp-heading"><div><span className="cp-eyebrow">R E N T E A S E · FINANCE</span><h2>{role === 'admin' ? 'Organization revenue' : 'Your earnings'}</h2><p>Transparent allocations. Every amount traces back to a booking or verified delivery.</p></div><button onClick={load} disabled={loading}><UiIcon name="refresh" size={17} />Refresh</button></header>
    <form className="cp-filters" onSubmit={(event) => event.preventDefault()}>
      {role === 'admin' && <label>Revenue type<select name="kind" value={filters.kind} onChange={update}><option value="">All revenue</option><option value="rental">Rentals · 5%</option><option value="delivery">Delivery · 1%</option></select></label>}
      <label>Allocation status<select name="status" value={filters.status} onChange={update}><option value="">All statuses</option><option value="pending">Pending completion</option><option value="earned">Earned · awaiting settlement</option><option value="settled">Settlement recorded</option><option value="reversed">Reversed</option></select></label>
      <label>From<input type="date" name="from" value={filters.from} onChange={update} /></label>
      <label>To<input type="date" name="to" value={filters.to} onChange={update} /></label>
    </form>
    {error && <p className="cp-error" role="alert">{error}<button onClick={load}>Try again</button></p>}
    {loading && !data ? <p role="status">Loading financial records…</p> : <>
      <div className="cp-stats">{cards.map(([label, amount, detail]) => <article key={label}><span><UiIcon name="wallet" size={18} /></span><small>{label}</small><strong>{money(amount)}</strong><p>{detail}</p></article>)}</div>
      <p className="cp-ledger-note"><UiIcon name="shield" size={18} />{data?.settlementNote || 'These are commission allocations, not confirmation of a bank transfer.'} Sandbox records remain identified in the history.</p>
      <div className="cp-table-wrap"><table><caption>Commission transaction history</caption><thead><tr><th>Booking / delivery</th><th>Recorded</th><th>Type</th><th>Gross</th><th>Commission</th><th>Net earnings</th><th>Status</th></tr></thead><tbody>
        {(data?.entries || []).map((row) => <tr key={row._id}><td><b>RE-{String(row.rentalId).slice(-8).toUpperCase()}</b>{row.deliveryTaskId && <small>Trip {String(row.deliveryTaskId).slice(-6).toUpperCase()}</small>}<small>{row.paymentProvider === 'sandbox' ? 'Sandbox · no real funds charged' : row.paymentProvider}</small></td><td>{new Date(row.createdAt).toLocaleDateString('en-LK')}<small>{new Date(row.createdAt).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit' })}</small></td><td>{row.kind === 'rental' ? 'Rental · 5%' : `${row.direction === 'return' ? 'Return' : 'Delivery'} · 1%`}</td><td>{money(row.grossMinor - (row.refundedGrossMinor || 0))}</td><td>{money(row.commissionMinor - (row.reversedCommissionMinor || 0))}</td><td>{money(row.netMinor - (row.refundedGrossMinor || 0) + (row.reversedCommissionMinor || 0))}</td><td><span className={`cp-status cp-${row.status}`}>{row.status === 'earned' ? 'Earned · unsettled' : row.status === 'pending' ? 'Pending completion' : row.status === 'settled' ? 'Settlement recorded' : 'Reversed'}</span></td></tr>)}
        {!data?.entries?.length && <tr><td colSpan={7} className="cp-empty">No commission records match this view. New eligible payments and completed deliveries will appear here.</td></tr>}
      </tbody></table></div>
      {(data?.pages || 0) > 1 && <nav className="cp-pagination" aria-label="Commission history pages"><button disabled={loading || filters.page === 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</button><span>Page {filters.page} of {data.pages}</span><button disabled={loading || filters.page >= data.pages} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</button></nav>}
    </>}
  </section>
}
