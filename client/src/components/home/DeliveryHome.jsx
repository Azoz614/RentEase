import { useCallback, useEffect, useState } from 'react'
import './workspace.css'

const currency = (value) => `LKR ${Number(value || 0).toLocaleString('en-LK')}`
const stages = [
  ['assigned', 'Assigned'], ['on_the_way', 'On the way'], ['delivered', 'Delivered'],
  ['return_pickup', 'Return pickup'], ['returning', 'Returning'], ['returned', 'Returned'],
]
const nextStage = (status = 'assigned') => stages[stages.findIndex(([key]) => key === status) + 1]

export default function DeliveryHome({ user, api, onLogout }) {
  const [section, setSection] = useState('deliveries')
  const [requests, setRequests] = useState([])
  const [notifications, setNotifications] = useState([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const [jobs, inbox] = await Promise.all([api('/api/delivery/assignments'), api('/api/inbox')])
      setRequests(jobs.requests || []); setNotifications(inbox.notifications || []); setError('')
    } catch (loadError) { setError(loadError.message) }
  }, [api])
  useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer) }, [load])

  const activeItems = requests.flatMap((request) => request.items.map((item) => ({ request, item })))
  const activeCount = activeItems.filter(({ item }) => item.deliveryStatus !== 'returned').length
  const updateStatus = async (request, item, status) => {
    const id = `${request._id}-${item.productId}`
    setBusy(id); setError(''); setNotice('')
    try {
      const result = await api(`/api/delivery/assignments/${request._id}/items/${item.productId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setNotice(result.message); await load()
    } catch (statusError) { setError(statusError.message) } finally { setBusy('') }
  }

  return <main className="business-shell delivery-shell">
    <aside className="business-sidebar"><a className="business-brand" href="/"><span>r</span>RentEase <small>DELIVERY</small></a><div className="business-shop-card"><div className="business-avatar delivery-avatar">{(user.username || 'D')[0].toUpperCase()}</div><div><b>{user.username}</b><small>Delivery partner</small></div><i className="driver-online">On duty</i></div><nav className="business-menu" aria-label="Delivery partner workspace"><button className={section === 'deliveries' ? 'selected' : ''} onClick={() => setSection('deliveries')}><span>↗</span>My deliveries{activeCount > 0 && <b>{activeCount}</b>}</button><button className={section === 'inbox' ? 'selected' : ''} onClick={() => setSection('inbox')}><span>✉</span>Updates{notifications.filter((item) => !item.readAt).length > 0 && <b>{notifications.filter((item) => !item.readAt).length}</b>}</button></nav><div className="business-sidebar-foot"><div><span className="online-dot" />Assignment refresh every 30 sec</div><button onClick={onLogout}>Sign out</button></div></aside>
    <section className="business-main"><header className="business-topbar"><div><small>DELIVERY PARTNER / {section.toUpperCase()}</small><h1>{section === 'deliveries' ? 'Your delivery route' : 'Mailbox updates'}</h1></div><div className="business-top-actions"><button onClick={load} aria-label="Refresh assignments">↻</button><span className="business-avatar-small">{(user.username || 'D')[0].toUpperCase()}</span></div></header>
      {error && <div className="workspace-alert is-error" role="alert">{error}</div>}{notice && <div className="workspace-alert" role="status">{notice}</div>}
      {section === 'deliveries' && <>
        <div className="driver-welcome"><div><span className="workspace-kicker">DELIVERY OPERATIONS</span><h2>Good day, {user.username}.</h2><p>Keep customers and rental providers informed as each item moves through its delivery.</p></div><span className="driver-map-mark">⌖<small>BATTICALOA<br />SRI LANKA</small></span></div>
        <div className="business-stat-grid driver-stat-grid"><article><span className="business-stat-icon blue">↗</span><small>Active assignments</small><b>{activeCount}</b><em>Across {requests.length} booking requests</em></article><article><span className="business-stat-icon green">✓</span><small>Completed returns</small><b>{activeItems.filter(({ item }) => item.deliveryStatus === 'returned').length}</b><em>Ready for the next assignment</em></article><article><span className="business-stat-icon amber">LKR</span><small>Delivery fee value</small><b>{currency(requests.reduce((sum, request) => sum + Number(request.deliveryFee || 0), 0))}</b><em>Fees on assigned requests</em></article></div>
        <section className="workspace-card driver-jobs"><div className="workspace-card-head"><div><small className="workspace-kicker">ASSIGNED TO YOU</small><h2>Delivery and return jobs</h2><p>Update each item as you complete the next step.</p></div><span className="booking-count">{activeItems.length} items</span></div>{requests.length ? requests.map((request) => <article className="driver-request" key={request._id}><div className="driver-request-head"><div><span className="driver-job-code">JOB · {String(request._id).slice(-7).toUpperCase()}</span><h3>{request.customerId?.username || 'Customer'} <small>{request.customerId?.phone || 'No phone provided'}</small></h3></div><span className="driver-delivery-type">{request.deliveryMethod === 'partner' ? 'Delivery + return' : 'Delivery'}</span></div><div className="driver-address"><span>⌖</span><div><small>DROP-OFF ADDRESS</small><b>{request.address || 'Address not provided'}</b></div></div><div className="driver-route-meta"><span>{new Date(request.startDate).toLocaleDateString()} – {new Date(request.endDate).toLocaleDateString()}</span><span>{request.distanceKm?.toFixed(1) || '0.0'} km</span><span>~{request.etaMinutes || 0} min</span><b>{currency(request.deliveryFee)}</b></div>{request.items.map((item) => { const stage = nextStage(item.deliveryStatus || 'assigned'); const index = stages.findIndex(([key]) => key === (item.deliveryStatus || 'assigned')); return <div className="driver-item" key={item.productId}><div className="driver-item-info"><img src={item.photo || ''} alt="" /><div><b>{item.title}</b><small>{item.decision === 'accepted' ? 'Provider confirmed' : 'Waiting for provider confirmation'}</small></div></div><div className="driver-stage"><div className="driver-progress">{stages.map(([key,label], step) => <span key={key} className={step <= index ? 'complete' : ''} title={label} />)}</div><small>{stages[index]?.[1] || 'Assigned'}</small></div>{stage ? <button className="driver-next" disabled={busy === `${request._id}-${item.productId}`} onClick={() => updateStatus(request, item, stage[0])}>{busy === `${request._id}-${item.productId}` ? 'Saving…' : `Mark ${stage[1].toLowerCase()}`}</button> : <b className="driver-finished">Return completed</b>}</div>})}</article>) : <div className="workspace-empty">No assignments yet. New delivery requests will appear here.</div>}</section>
      </>}
      {section === 'inbox' && <section className="workspace-card"><div className="workspace-card-head"><div><small className="workspace-kicker">IN-APP NOTIFICATIONS</small><h2>Recent updates</h2><p>Booking and delivery status changes for your account.</p></div></div>{notifications.length ? notifications.map((item) => <article className="driver-notification" key={item._id}><span>✉</span><div><b>{item.title}</b><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div></article>) : <div className="workspace-empty">No updates yet. Assignment notifications will appear here.</div>}</section>}
    </section>
  </main>
}
