import DeliveryTaskBoard from '../components/DeliveryTaskBoard.jsx'
import { useDeliveryRefresh } from '../hooks/useDeliveryEvents.js'
import { formatCurrency as currency } from '../../../utils/currency.js'
import { useCallback, useEffect, useState } from 'react'
import '../../../layouts/workspace.css'
import { BrandMark } from '../../../components/ui/BrandMark.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { WorkspaceNav } from '../../../components/ui/WorkspaceNav.jsx'
import { DeliveryWorkspace } from '../../maps/components/DeliveryWorkspace.jsx'
import { stages as deliveryStages } from '../../maps/utils/deliveryStages.js'

const stages = deliveryStages.map((key) => [key, key.replaceAll('_', ' ')])
const nextStage = (status = 'assigned') => stages[stages.findIndex(([key]) => key === status) + 1]

export default function DeliveryHome({ user, api, onLogout }) {
  const [dispatchStats, setDispatchStats] = useState({
    active: 0,
    completed: 0,
    fee: 0,
    online: false,
  })
  const [section, setSection] = useState('deliveries')
  const [requests, setRequests] = useState([])
  const [notifications, setNotifications] = useState([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const [jobs, inbox] = await Promise.all([api('/api/delivery/assignments'), api('/api/inbox')])
      setRequests(jobs.requests || [])
      setNotifications(inbox.notifications || [])
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    }
  }, [api])
  useDeliveryRefresh(load)
  useEffect(() => {
    load()
    const timer = setInterval(load, 30000)
    return () => clearInterval(timer)
  }, [load])

  const activeItems = requests.flatMap((request) =>
    request.items.map((item) => ({ request, item })),
  )
  const activeCount =
    activeItems.filter(({ item }) => item.deliveryStatus !== 'returned').length +
    dispatchStats.active
  const updateStatus = async (request, item, status) => {
    const id = `${request._id}-${item.productId}`
    setBusy(id)
    setError('')
    setNotice('')
    try {
      const result = await api(
        `/api/delivery/assignments/${request._id}/items/${item.productId}/status`,
        { method: 'PATCH', body: JSON.stringify({ status }) },
      )
      setNotice(result.message)
      await load()
    } catch (statusError) {
      setError(statusError.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <main className="business-shell delivery-shell">
      <aside className="business-sidebar">
        <a className="business-brand" href="/">
          <BrandMark />
          RentEase <small>DELIVERY</small>
        </a>
        <div className="business-shop-card">
          <div className="business-avatar delivery-avatar">
            {(user.username || 'D')[0].toUpperCase()}
          </div>
          <div>
            <b>{user.username}</b>
            <small>Delivery partner</small>
          </div>
          <i className="driver-online">{dispatchStats.online ? 'Online' : 'Offline'}</i>
        </div>
        <WorkspaceNav
          onLogout={onLogout}
          className="business-menu"
          label="Delivery partner workspace"
          active={section}
          items={[
            { id: 'deliveries', label: 'My deliveries', badge: activeCount },
            {
              id: 'inbox',
              label: 'Updates',
              badge: notifications.filter((item) => !item.readAt).length,
            },
          ]}
          onSelect={setSection}
        />
        <div className="business-sidebar-foot">
          <div>
            <span className="online-dot" />
            Automatic assignment updates
          </div>
          <button onClick={onLogout}>
            <UiIcon name="logout" size={17} />
            Sign out
          </button>
        </div>
      </aside>
      <section className="business-main">
        <header className="business-topbar">
          <div>
            <small>DELIVERY PARTNER / {section.toUpperCase()}</small>
            <h1>{section === 'deliveries' ? 'Your delivery route' : 'Mailbox updates'}</h1>
          </div>
          <div className="business-top-actions">
            <button onClick={load} aria-label="Refresh assignments">
              <UiIcon name="refresh" size={17} />
            </button>
            <span className="business-avatar-small">{(user.username || 'D')[0].toUpperCase()}</span>
          </div>
        </header>
        {error && (
          <div className="workspace-alert is-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="workspace-alert" role="status">
            {notice}
          </div>
        )}
        {section === 'deliveries' && (
          <>
            <div className="driver-welcome">
              <div>
                <span className="workspace-kicker">DELIVERY OPERATIONS</span>
                <h2>Good day, {user.username}.</h2>
                <p>Your assignments, pickups and returns in one place.</p>
              </div>
              <span className="driver-map-mark">
                <UiIcon name="map" size={40} />
                <small>
                  YOUR ACTIVE
                  <br />
                  DELIVERIES
                </small>
              </span>
            </div>
            <div className="business-stat-grid driver-stat-grid">
              <article>
                <span className="business-stat-icon blue">
                  <UiIcon name="truck" />
                </span>
                <small>Active assignments</small>
                <b>{activeCount}</b>
                <em>Trips assigned to your account</em>
              </article>
              <article>
                <span className="business-stat-icon green">
                  <UiIcon name="check" />
                </span>
                <small>Completed returns</small>
                <b>
                  {activeItems.filter(({ item }) => item.deliveryStatus === 'returned').length +
                    dispatchStats.completed}
                </b>
                <em>Ready for the next assignment</em>
              </article>
              <article>
                <span className="business-stat-icon amber">
                  <UiIcon name="wallet" />
                </span>
                <small>Delivery fee value</small>
                <b>
                  {currency(
                    requests.reduce((sum, request) => sum + Number(request.deliveryFee || 0), 0) +
                      dispatchStats.fee,
                  )}
                </b>
                <em>Fees on assigned requests</em>
              </article>
            </div>
            <DeliveryTaskBoard api={api} role="delivery_partner" onSummary={setDispatchStats} />
            <DeliveryWorkspace api={api} role="delivery_partner" />
            {!!requests.length && (<section className="workspace-card driver-jobs">
              <div className="workspace-card-head">
                <div>
                  <small className="workspace-kicker">ASSIGNED TO YOU</small>
                  <h2>Delivery and return jobs</h2>
                  <p>Update each item as you complete the next step.</p>
                </div>
                <span className="booking-count">{activeItems.length} items</span>
              </div>
              {requests.length ? (
                requests.map((request) => (
                  <article className="driver-request" key={request._id}>
                    <div className="driver-request-head">
                      <div>
                        <span className="driver-job-code">
                          JOB · {String(request._id).slice(-7).toUpperCase()}
                        </span>
                        <h3>
                          {request.customerId?.username || 'Customer'}{' '}
                          <small>{request.customerId?.phone || 'No phone provided'}</small>
                        </h3>
                      </div>
                      <span className="driver-delivery-type">
                        {request.deliveryMethod === 'partner' ? 'Delivery + return' : 'Delivery'}
                      </span>
                    </div>
                    <div className="driver-address">
                      <span>
                        <UiIcon name="pin" size={22} />
                      </span>
                      <div>
                        <small>DROP-OFF ADDRESS</small>
                        <b>{request.address || 'Address not provided'}</b>
                      </div>
                    </div>
                    <div className="driver-route-meta">
                      <span>
                        {new Date(request.startDate).toLocaleDateString()} –{' '}
                        {new Date(request.endDate).toLocaleDateString()}
                      </span>
                      <span>{request.distanceKm?.toFixed(1) || '0.0'} km</span>
                      <span>~{request.etaMinutes || 0} min</span>
                      <b>{currency(request.deliveryFee)}</b>
                    </div>
                    {request.items.map((item) => {
                      const stage = nextStage(item.deliveryStatus || 'assigned')
                      const index = stages.findIndex(
                        ([key]) => key === (item.deliveryStatus || 'assigned'),
                      )
                      return (
                        <div className="driver-item" key={item.productId}>
                          <div className="driver-item-info">
                            <img src={item.photo || ''} alt="" />
                            <div>
                              <b>{item.title}</b>
                              <small>
                                {item.decision === 'accepted'
                                  ? 'Provider confirmed'
                                  : 'Waiting for provider confirmation'}
                              </small>
                            </div>
                          </div>
                          <div className="driver-stage">
                            <div className="driver-progress">
                              {stages.map(([key, label], step) => (
                                <span
                                  key={key}
                                  className={step <= index ? 'complete' : ''}
                                  title={label}
                                />
                              ))}
                            </div>
                            <small>{stages[index]?.[1] || 'Assigned'}</small>
                          </div>
                          {stage ? (
                            <button
                              className="driver-next"
                              title={item.progressBlocked || ''}
                              disabled={
                                busy === `${request._id}-${item.productId}` ||
                                Boolean(item.progressBlocked)
                              }
                              onClick={() => updateStatus(request, item, stage[0])}
                            >
                              {busy === `${request._id}-${item.productId}`
                                ? 'Saving…'
                                : `Mark ${stage[1].toLowerCase()}`}
                            </button>
                          ) : (
                            <b className="driver-finished">Return completed</b>
                          )}
                          {item.progressBlocked && <small>{item.progressBlocked}</small>}
                        </div>
                      )
                    })}
                  </article>
                ))
              ) : (
                <div className="workspace-empty">
                  No assignments yet. New delivery requests will appear here.
                </div>
              )}
            </section>)}
          </>
        )}
        {section === 'inbox' && (
          <section className="workspace-card">
            <div className="workspace-card-head">
              <div>
                <small className="workspace-kicker">IN-APP NOTIFICATIONS</small>
                <h2>Recent updates</h2>
                <p>Booking and delivery status changes for your account.</p>
              </div>
            </div>
            {notifications.length ? (
              notifications.map((item) => (
                <article className="driver-notification" key={item._id}>
                  <span>
                    <UiIcon name="mail" size={20} />
                  </span>
                  <div>
                    <b>{item.title}</b>
                    <p>{item.body}</p>
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                  </div>
                </article>
              ))
            ) : (
              <div className="workspace-empty">
                No updates yet. Assignment notifications will appear here.
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  )
}
