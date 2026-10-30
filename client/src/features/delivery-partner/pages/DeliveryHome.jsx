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
import NotificationBell from '../../notifications/components/NotificationBell.jsx'
import NotificationCenter from '../../notifications/pages/NotificationCenter.jsx'
import CommissionPanel from '../../payments/components/CommissionPanel.jsx'
import { useNotificationCount } from '../../notifications/hooks/useNotificationCount.js'
import WorkspaceAccountMenu from '../../../components/account/WorkspaceAccountMenu.jsx'
import WorkspaceFooter from '../../../components/layout/WorkspaceFooter.jsx'

const stages = deliveryStages.map((key) => [key, key.replaceAll('_', ' ')])
const nextStage = (status = 'assigned') => stages[stages.findIndex(([key]) => key === status) + 1]

export default function DeliveryHome({ user, api, onLogout, onAccountUpdate }) {
  const unread = useNotificationCount(api)
  const [dispatchStats, setDispatchStats] = useState({
    active: 0,
    completed: 0,
    fee: 0,
    online: false,
  })
  const [section, setSection] = useState('deliveries')
  const [requests, setRequests] = useState([])
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const jobs = await api('/api/delivery/assignments')
      setRequests(jobs.requests || [])
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
            { id: 'earnings', label: 'Earnings' },
            {
              id: 'inbox',
              label: 'Updates',
              badge: unread,
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
            <h1>{{ deliveries: 'My deliveries', inbox: 'Notifications', earnings: 'Earnings' }[section] || 'My deliveries'}</h1>
          </div>
          <div className="business-top-actions">
            <NotificationBell api={api} unreadCount={unread} onHistory={() => setSection('inbox')} onNavigate={() => setSection('deliveries')} />
            <button onClick={load} aria-label="Refresh assignments">
              <UiIcon name="refresh" size={17} />
            </button>
            <WorkspaceAccountMenu user={user} api={api} onLogout={onLogout} onAccountUpdate={onAccountUpdate} />
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
        {/* Stays mounted while hidden: unmounting the board would take the rider offline. */}
        <div hidden={section !== 'deliveries'}>
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
                <small>Completed trips</small>
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
                <small>Trip fees</small>
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
            <details className="driver-tracking-details">
              <summary><UiIcon name="map" size={20} /><span>Route map<small>Driving directions and live location</small></span><UiIcon name="chevron" size={18} /></summary>
              <DeliveryWorkspace api={api} role="delivery_partner" />
            </details>
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
        </div>
        {section === 'inbox' && (
          <NotificationCenter api={api} onNavigate={() => setSection('deliveries')} />
        )}
        {section === 'earnings' && <CommissionPanel api={api} role="delivery_partner" />}
      </section>
      <WorkspaceFooter />
    </main>
  )
}
