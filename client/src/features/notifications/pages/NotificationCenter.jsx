import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { notificationsChanged } from '../hooks/useNotificationCount.js'
import '../styles/notifications.css'

function group(date, now) {
  const day = (value) => new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  return day(date) === day(now) ? 'Today' : day(date) === day(now - 86400000) ? 'Yesterday' : 'Earlier'
}
function relative(value, now) {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`
  return new Date(value).toLocaleDateString('en-LK', { day: 'numeric', month: 'short' })
}
const fullDate = (value) => new Date(value).toLocaleString('en-LK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const icon = (row) => row.type === 'handover_otp' ? 'lock' : /review/i.test(row.title) ? 'star' : /verif|identity/i.test(row.type + row.title) ? 'shield' : /pay|deposit|refund/i.test(row.title) ? 'wallet' : row.type === 'delivery' ? 'truck' : 'box'
const category = (row) => ({ lock: 'Handover code', star: 'Review', shield: 'Verification', wallet: 'Payment', truck: 'Delivery' })[icon(row)] || 'Booking update'
// The button that takes the reader to whatever the notification is about.
const destination = (row) => /review/i.test(row.title) ? 'See reviews' : row.link === 'verification' ? 'Open verification' : row.link === 'addresses' ? 'Open saved addresses' : row.deliveryTaskId || row.type === 'delivery' ? 'Go to delivery' : row.requestId || row.link === 'requests' ? 'Go to booking' : ''
const realId = (id) => /^[a-f\d]{24}$/i.test(String(id))
const timestamp = () => new Date().toISOString()
// An unread card counts as seen once at least 60% of it stays on screen for this long.
const SEEN_AFTER_MS = 1000

export default function NotificationCenter({ api, onNavigate, onChange, compact = false, onHistory }) {
  const [notifications, setNotifications] = useState([]), [error, setError] = useState(''), [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true), [hasMore, setHasMore] = useState(false), [busy, setBusy] = useState('')
  const [now, setNow] = useState(Date.now), [selectedId, setSelectedId] = useState(null)
  const rows = useRef([]), sequence = useRef(0), pending = useRef(new Set()), mounted = useRef(false)
  const feed = useRef(null), seen = useRef(new Set()), queue = useRef(new Set()), flushTimer = useRef(null)
  const change = useRef(onChange)
  useEffect(() => { change.current = onChange }, [onChange])
  const commit = useCallback((next) => { rows.current = next; setNotifications(next); change.current?.(next) }, [])
  const load = useCallback(async (more = false) => {
    const current = ++sequence.current
    try {
      const query = new URLSearchParams()
      if (compact) query.set('limit', '5')
      if (filter !== 'all') query.set('filter', filter)
      if (more) query.set('offset', String(rows.current.length))
      const result = await api(`/api/inbox${query.size ? `?${query}` : ''}`)
      if (!mounted.current || current !== sequence.current) return
      commit(more ? [...rows.current, ...(result.notifications || [])] : result.notifications || [])
      setHasMore(Boolean(result.hasMore)); setError('')
    } catch (failure) { if (mounted.current && current === sequence.current) setError(failure.message) }
    finally { if (mounted.current && current === sequence.current) setLoading(false) }
  }, [api, compact, commit, filter])
  useEffect(() => {
    mounted.current = true
    queueMicrotask(() => { if (mounted.current) load() })
    const refresh = () => { if (document.visibilityState !== 'hidden' && !pending.current.size) load() }
    const timer = setInterval(() => { setNow(Date.now()); if (document.visibilityState !== 'hidden' && !pending.current.size) load() }, 20000)
    window.addEventListener('focus', refresh); window.addEventListener('rentease:delivery', refresh)
    return () => { mounted.current = false; sequence.current += 1; clearInterval(timer); clearTimeout(flushTimer.current); window.removeEventListener('focus', refresh); window.removeEventListener('rentease:delivery', refresh) }
  }, [load])
  const mark = async (row, read = !row.readAt) => {
    if (pending.current.has(row._id)) return false
    // A notification the reader deliberately marks unread is never auto-read again in this view.
    seen.current.add(row._id)
    pending.current.add(row._id); sequence.current += 1; setBusy(row._id); setError('')
    const previous = row.readAt
    commit(rows.current.map((entry) => entry._id === row._id ? { ...entry, readAt: read ? new Date().toISOString() : null } : entry))
    try {
      const result = await api(`/api/notifications/${row._id}`, { method: 'PATCH', body: JSON.stringify({ read }) })
      if (!mounted.current) return true
      if (result.notification) commit(rows.current.map((entry) => entry._id === row._id ? result.notification : entry))
      notificationsChanged(); return true
    } catch (failure) {
      if (mounted.current) { commit(rows.current.map((entry) => entry._id === row._id ? { ...entry, readAt: previous } : entry)); setError(failure.message) }
      return false
    } finally { pending.current.delete(row._id); if (mounted.current) setBusy('') }
  }
  // Notifications seen on screen are marked read together in one request.
  const flush = useCallback(async () => {
    const ids = [...queue.current].filter((id) => rows.current.some((row) => row._id === id && !row.readAt))
    queue.current.clear()
    if (!ids.length || !mounted.current) return
    sequence.current += 1
    const at = timestamp()
    commit(rows.current.map((row) => ids.includes(row._id) && !row.readAt ? { ...row, readAt: at } : row))
    try {
      await api('/api/inbox/read', { method: 'PATCH', body: JSON.stringify({ ids }) })
      notificationsChanged()
    } catch {
      ids.forEach((id) => seen.current.delete(id))
      if (mounted.current) commit(rows.current.map((row) => ids.includes(row._id) && row.readAt === at ? { ...row, readAt: null } : row))
    }
  }, [api, commit])
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function' || !feed.current) return
    const timers = new Map()
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      const id = entry.target.dataset.unreadId
      if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
        if (timers.has(id)) return
        timers.set(id, setTimeout(() => {
          timers.delete(id)
          if (document.visibilityState === 'hidden' || seen.current.has(id)) return
          seen.current.add(id); queue.current.add(id)
          clearTimeout(flushTimer.current); flushTimer.current = setTimeout(flush, 250)
        }, SEEN_AFTER_MS))
      } else { clearTimeout(timers.get(id)); timers.delete(id) }
    }), { threshold: [0, 0.6, 1] })
    feed.current.querySelectorAll('[data-unread-id]').forEach((node) => observer.observe(node))
    return () => { observer.disconnect(); timers.forEach(clearTimeout) }
  }, [notifications, filter, flush])
  const openDetails = (row) => {
    setSelectedId(row._id)
    if (!row.readAt) mark(row, true)
  }
  const go = (row) => { setSelectedId(null); onNavigate?.(row.link || 'requests', row) }
  const markAll = async () => {
    if (pending.current.size) return
    pending.current.add('all'); setBusy('all'); setError(''); sequence.current += 1
    const previous = rows.current
    commit(rows.current.map((row) => ({ ...row, readAt: row.readAt || new Date().toISOString() })))
    try { await api('/api/inbox/read', { method: 'PATCH', body: '{}' }); notificationsChanged() }
    catch (failure) { if (mounted.current) { commit(previous); setError(failure.message) } }
    finally { pending.current.delete('all'); if (mounted.current) setBusy('') }
  }
  const visible = notifications.filter((row) => (filter === 'all' || (filter === 'read' ? Boolean(row.readAt) : !row.readAt)) && (!row.expiresAt || new Date(row.expiresAt).getTime() > now))
  const selected = notifications.find((row) => row._id === selectedId)
  const details = selected && <NotificationDetails row={selected} now={now} compact={compact} busy={Boolean(busy)} onClose={() => setSelectedId(null)} onGo={() => go(selected)} onToggleRead={() => mark(selected)} />
  return <section className={`notification-center${compact ? ' is-compact' : ''}`} aria-label="Notification center">
    <header className="nc-heading"><div>{compact ? <h2>Notifications</h2> : <h1>Notifications</h1>}<p>Your bookings, handovers and account activity.</p></div><span className="nc-bell"><UiIcon name="bell" size={24} /></span></header>
    {compact && details ? details : <>
    <div className="nc-toolbar"><nav aria-label="Notification filters">{['all', 'unread', 'read'].map((key) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{key[0].toUpperCase() + key.slice(1)}</button>)}</nav>
      <button className="nc-mark-all" disabled={Boolean(busy) || !notifications.some((row) => !row.readAt)} onClick={markAll}>Mark all as read</button></div>
    {error && <p className="nc-error" role="alert">{error}<button onClick={() => load()}>Retry</button></p>}
    <div className="nc-feed" aria-busy={loading} ref={feed}>
      {loading ? <><div className="nc-skeleton" /><div className="nc-skeleton" /><span className="nc-sr" role="status">Loading notifications</span></> : ['Today', 'Yesterday', 'Earlier'].map((label) => {
        const entries = visible.filter((row) => group(row.createdAt, now) === label)
        return entries.length > 0 && <section className="nc-group" key={label} aria-label={label}><h3>{label}</h3>{entries.map((row) => <article key={row._id} className={`nc-row${row.readAt ? ' is-read' : ' is-unread'}`} data-unread-id={!row.readAt && realId(row._id) ? row._id : undefined}>
          <span className={`nc-type nc-type-${row.type}`}><UiIcon name={icon(row)} size={21} /></span>
          <div className="nc-content"><div className="nc-row-heading"><h4><button type="button" className="nc-open" onClick={() => openDetails(row)}>{row.title}</button></h4>{!row.readAt && <span className="nc-new">NEW</span>}</div>
            {row.type === 'handover_otp' && <span className="nc-private">Private handover code</span>}<p>{row.body}</p>
            <time dateTime={row.createdAt} title={new Date(row.createdAt).toLocaleString('en-LK')}>{relative(row.createdAt, now)}</time>
            {row.expiresAt && <small className="nc-expiry">Expires at {new Date(row.expiresAt).toLocaleTimeString('en-LK')}</small>}
            <div className="nc-actions"><button disabled={Boolean(busy)} onClick={() => mark(row)}>{row.readAt ? 'Mark unread' : 'Mark read'}</button></div>
          </div></article>)}</section>
      })}
      {!loading && !visible.length && <div className="nc-empty"><UiIcon name="bell" size={32} /><h3>{filter === 'unread' ? 'You’re all caught up' : 'No updates in this view'}</h3><p>Your notification history stays here after you read it.</p></div>}
    </div>
    {!compact && hasMore && <button className="nc-more" onClick={() => load(true)} disabled={Boolean(busy)}>Load older updates</button>}
    {compact && <button className="nc-history" onClick={onHistory}>View all notifications <UiIcon name="arrow" size={16} /></button>}
    </>}
    {!compact && details && createPortal(<div className="nc-overlay" onClick={(event) => { if (event.target === event.currentTarget) setSelectedId(null) }}>{details}</div>, document.body)}
  </section>
}

function NotificationDetails({ row, now, compact, busy, onClose, onGo, onToggleRead }) {
  const close = useRef(null), latestClose = useRef(onClose)
  useEffect(() => { latestClose.current = onClose })
  // Focus moves to the close button once per opened notification, not on every re-render.
  useEffect(() => {
    close.current?.focus()
    const escape = (event) => { if (event.key === 'Escape') { event.stopPropagation(); latestClose.current() } }
    document.addEventListener('keydown', escape, true)
    return () => document.removeEventListener('keydown', escape, true)
  }, [row._id])
  const action = destination(row)
  return <div className={`nc-detail${compact ? ' is-inline' : ''}`} role="dialog" aria-modal={compact ? undefined : 'true'} aria-labelledby={`nc-detail-${row._id}`}>
    <div className="nc-detail-top">
      <button type="button" ref={close} className="nc-detail-back" onClick={onClose} aria-label={compact ? 'Back to notifications' : 'Close notification'}>
        <UiIcon name={compact ? 'arrow' : 'close'} size={18} />{compact && 'Back'}
      </button>
    </div>
    <div className="nc-detail-head">
      <span className={`nc-type nc-type-${row.type}`}><UiIcon name={icon(row)} size={24} /></span>
      <div><span className="nc-detail-category">{category(row)}</span><h2 id={`nc-detail-${row._id}`}>{row.title}</h2></div>
    </div>
    {row.type === 'handover_otp' && <p className="nc-detail-private"><UiIcon name="lock" size={16} />Private handover code. Share it only with the person handing over your items.</p>}
    <p className="nc-detail-body">{row.body}</p>
    <dl className="nc-detail-facts">
      <div><dt>Received</dt><dd>{fullDate(row.createdAt)} <small>({relative(row.createdAt, now)})</small></dd></div>
      {row.requestId && <div><dt>Booking</dt><dd>RE-{String(row.requestId).slice(-8).toUpperCase()}</dd></div>}
      {row.expiresAt && <div><dt>Expires</dt><dd>{fullDate(row.expiresAt)}</dd></div>}
      <div><dt>Status</dt><dd>{row.readAt ? `Read ${relative(row.readAt, now).toLowerCase()}` : 'Unread'}</dd></div>
    </dl>
    <div className="nc-detail-actions">
      {action && <button type="button" className="nc-detail-primary" onClick={onGo}>{action}<UiIcon name="arrow" size={16} /></button>}
      <button type="button" className="nc-detail-secondary" disabled={busy} onClick={onToggleRead}>{row.readAt ? 'Mark as unread' : 'Mark as read'}</button>
    </div>
  </div>
}
