import { useEffect, useState } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { formatCurrency } from '../../../utils/currency.js'
import '../styles/rental-job.css'

const shortDate = (value) => value && Number.isFinite(new Date(value).getTime())
  ? new Date(value).toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not recorded'

export function RentalJobSummary({ rental, status, meta }) {
  const item = rental.items?.[0]
  const photo = item?.image || item?.product?.photos?.[0]
  return <section className="rental-job-summary" aria-label="Rental job overview">
    <div className="rental-job-cover">
      <UiIcon name="box" size={36} />
      {photo && <img src={photo} alt="" onError={(event) => { event.currentTarget.hidden = true }} />}
    </div>
    <div className="rental-job-title">
      <span className="rental-job-kicker">EVERY STEP, IN ONE PLACE</span>
      <h3>{item?.title || 'Your rental job'}</h3>
      <p>{rental.items?.length > 1 ? `+ ${rental.items.length - 1} more ${rental.items.length === 2 ? 'item' : 'items'}` : item?.category || 'Rental booking'}{meta && <> · {meta}</>}</p>
      <div className="rental-job-status">{status}</div>
    </div>
    <div className="rental-job-value"><small>Booked rental total</small><strong>{formatCurrency(rental.total || 0)}</strong><span>#{String(rental._id).slice(-8).toUpperCase()}</span></div>
    <dl className="rental-job-facts">
      <div><dt><UiIcon name="calendar" size={16} /> Rental period</dt><dd>{shortDate(rental.startDate)} <span>→</span> {shortDate(rental.endDate)}</dd></div>
      <div><dt><UiIcon name={rental.deliveryMethod === 'partner' ? 'truck' : 'box'} size={16} /> Pickup</dt><dd>{rental.deliveryMethod === 'partner' ? 'Delivery partner' : 'Collect from shop'}</dd></div>
      <div><dt><UiIcon name="refresh" size={16} /> Return</dt><dd>{rental.returnMethod === 'partner' ? 'Rider collection' : rental.returnMethod === 'pickup' ? 'Return to shop' : 'Choose when ready'}</dd></div>
    </dl>
  </section>
}

export function RentalJobCodes({ notifications = [] }) {
  const [now, setNow] = useState(Date.now)
  const codes = notifications.filter((n) => n.type === 'handover_otp' || n.expiresAt)
  useEffect(() => {
    if (!codes.length) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [codes.length])
  return codes.filter((n) => new Date(n.expiresAt).getTime() > now).map((notice) => {
    const code = notice.body?.match(/\b\d{6}\b/)?.[0]
    const remaining = Math.max(0, Math.ceil((new Date(notice.expiresAt).getTime() - now) / 1000))
    return <aside className="rental-job-private" key={notice._id} aria-label="Your private handover code">
      <span className="rental-job-private-icon"><UiIcon name="shield" size={23} /></span>
      <div><span className="rental-job-kicker">PRIVATE · ONLY FOR YOU</span><h3>Your receipt code</h3>
        <p>Share with the person handing over the items after you receive them.</p></div>
      <div className="rental-job-private-value"><strong aria-label={`Receipt code ${code || ''}`}>{code || notice.body}</strong>
        <small>Expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</small></div>
    </aside>
  })
}
