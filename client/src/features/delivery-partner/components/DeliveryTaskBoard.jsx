import { useCallback, useEffect, useRef, useState } from 'react'
import PartnerAvailability from './PartnerAvailability.jsx'
import { useDeliveryRefresh } from '../hooks/useDeliveryEvents.js'
import GeoapifyMap from '../../maps/components/GeoapifyMap.jsx'
import { formatCurrencyFixed as money } from '../../../utils/currency.js'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import '../styles/delivery-dispatch.css'

const labels = {
  available: 'Waiting for a nearby partner',
  assigned: 'Partner assigned',
  heading_to_shop: 'Heading to shop',
  arrived_at_shop: 'Arrived at shop',
  picked_up: 'Picked up by delivery partner',
  on_the_way: 'On the way to customer',
  delivered: 'Delivered',
  return_pickup: 'Return partner assigned',
  heading_to_customer: 'Heading to customer',
  collected: 'Collected from customer · return in transit',
  returning: 'Returning to shop',
  returned: 'Return completed',
  cancelled: 'Cancelled',
}
const done = (task) => ['delivered', 'returned', 'cancelled'].includes(task.status)
const time = (value) =>
  new Date(value).toLocaleString('en-LK', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

export default function DeliveryTaskBoard({ api, role, onSummary }) {
  const [data, setData] = useState({ tasks: [], online: false }),
    [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const lifecycle = useRef({ mounted: false, sequence: 0 })
  const load = useCallback(async () => {
    if (!lifecycle.current.mounted) return
    const current = ++lifecycle.current.sequence
    try {
      const result = await api('/api/delivery/tasks')
      if (!lifecycle.current.mounted || current !== lifecycle.current.sequence) return
      setData(result)
      setLoadError('')
      const owned = result.tasks.filter((t) => t.canOperate),
        active = owned.filter((t) => !done(t))
      onSummary?.({
        active: active.length,
        completed: owned.filter((t) => t.status === 'returned').length,
        fee: active.reduce((sum, t) => sum + Number(t.fee || 0), 0),
        online: result.online,
      })
    } catch (failure) {
      if (lifecycle.current.mounted && current === lifecycle.current.sequence) setLoadError(failure.message)
    } finally {
      if (lifecycle.current.mounted && current === lifecycle.current.sequence) setLoading(false)
    }
  }, [api, onSummary])
  useEffect(() => {
    const state = lifecycle.current
    state.mounted = true
    queueMicrotask(() => { if (state.mounted) load() })
    const timer = setInterval(() => {
      if (!document.hidden) load()
    }, 15000)
    return () => {
      state.mounted = false
      state.sequence++
      clearInterval(timer)
    }
  }, [load])
  useDeliveryRefresh(load)
  const action = async (key, operation) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      const result = await operation()
      setNotice(result.message || 'Updated.')
      await load()
      window.dispatchEvent(new Event('rentease:delivery'))
    } catch (failure) {
      setError(failure.message)
      await load()
    } finally {
      setBusy('')
    }
  }
  const post = (path, body = {}) =>
    api('/api/delivery/' + path, { method: 'POST', body: JSON.stringify(body) })
  const offers = data.tasks.filter((t) => t.status === 'available' && role === 'delivery_partner')
  const active = data.tasks.filter(
    (t) => !done(t) && !(role === 'delivery_partner' && t.status === 'available'),
  )
  const completed = data.tasks.filter(done).slice(0, 12)
  const returns =
    role === 'user'
      ? [
          ...new Map(
            data.tasks
              .filter((t) => t.rentalStatus === 'active' && !t.returnRequested)
              .map((t) => [t.rentalId, t]),
          ).values(),
        ]
      : []
  return (
    <section className="dispatch-board" aria-label="Rental delivery and return handovers">
      <header className="dispatch-heading">
        <div>
          <span className="workspace-kicker">SECURE DELIVERY & RETURNS</span>
          <h2>
            {role === 'delivery_partner' ? 'Nearby requests & your trips' : 'Delivery progress'}
          </h2>
          <p>
            Live updates with automatic refresh fallback. Every physical handover requires its own
            email code.
          </p>
        </div>
        <button type="button" onClick={load} aria-label="Refresh delivery requests">
          <UiIcon name="refresh" size={18} />
        </button>
      </header>
      {role === 'delivery_partner' && <PartnerAvailability api={api} onRefresh={load} />}
      {data.busy && role === 'delivery_partner' && (
        <p className="dispatch-hint">Finish your current trip before accepting another request.</p>
      )}
      {notice && (
        <p role="status" className="dispatch-notice">
          {notice}
        </p>
      )}
      {(error || loadError) && (
        <p role="alert" className="re-map-error">
          {error || loadError}
        </p>
      )}
      {loading && (
        <p role="status" className="dispatch-loading">
          Loading delivery requests…
        </p>
      )}
      {returns.map((task) => (
        <button
          className="dispatch-primary"
          key={task.rentalId}
          type="button"
          disabled={Boolean(busy)}
          onClick={() => action(task.rentalId, () => post('rentals/' + task.rentalId + '/return'))}
        >
          Request return collection · #{String(task.rentalId).slice(-6).toUpperCase()}
        </button>
      ))}
      {role === 'delivery_partner' && (
        <section className="dispatch-offers">
          <h3>Nearby available requests</h3>
          <p>
            Online partners within {data.radiusKm || 10} km of pickup can accept. The first
            successful acceptance gets the trip.
          </p>
          {!offers.length && !loading && (
            <p className="dispatch-empty">
              {data.online
                ? 'No available nearby requests right now.'
                : 'Go online with your current location to receive requests.'}
            </p>
          )}
          {offers.map((task) => (
            <Trip
              key={task.id}
              task={task}
              api={api}
              role={role}
              busy={busy}
              action={action}
              post={post}
            />
          ))}
        </section>
      )}
      <div className="dispatch-trips">
        {active.map((task) => (
          <Trip
            key={task.id}
            task={task}
            api={api}
            role={role}
            busy={busy}
            action={action}
            post={post}
          />
        ))}
      </div>
      {!loading && !active.length && role !== 'delivery_partner' && (
        <p className="dispatch-empty">
          Approved deliveries and requested return collections will appear here.
        </p>
      )}
      {!!completed.length && (
        <details className="dispatch-completed">
          <summary>Recent completed handovers ({completed.length})</summary>
          {completed.map((task) => (
            <Trip
              key={task.id}
              task={task}
              api={api}
              role={role}
              busy={busy}
              action={action}
              post={post}
            />
          ))}
        </details>
      )}
    </section>
  )
}

function Trip({ task, api, role, busy, action, post }) {
  const [route, setRoute] = useState(null),
    [mapOpen, setMapOpen] = useState(false)
  const base = 'tasks/' + task.id
  const next = {
    assigned: ['heading_to_shop', 'Head to shop'],
    heading_to_shop: ['arrived_at_shop', 'Arrived at shop'],
    picked_up: ['on_the_way', 'Start delivery'],
    return_pickup: ['heading_to_customer', 'Head to customer'],
    collected: ['returning', 'Head back to shop'],
  }[task.status]
  const kind =
    task.direction === 'delivery'
      ? ['assigned', 'heading_to_shop', 'arrived_at_shop'].includes(task.status)
        ? 'shop_pickup'
        : ['picked_up', 'on_the_way'].includes(task.status)
          ? 'customer_delivery'
          : null
      : ['return_pickup', 'heading_to_customer'].includes(task.status)
        ? 'customer_return'
        : ['collected', 'returning'].includes(task.status)
          ? 'shop_return'
          : null
  const actionLabel = {
    shop_pickup: 'Collect product',
    customer_delivery: 'Deliver product',
    customer_return: 'Collect return',
    shop_return: 'Return to shop',
  }[kind]
  const challenge = task.challenge?.kind === kind ? task.challenge : null
  const canVerify = kind === 'shop_return' ? task.canManage : task.canOperate
  const target =
    task.canOperate &&
    [
      'assigned',
      'heading_to_shop',
      'arrived_at_shop',
      'return_pickup',
      'heading_to_customer',
    ].includes(task.status)
      ? task.pickup
      : task.destination
  const coordinates = target.location?.coordinates
  const navigate = coordinates
    ? 'https://www.google.com/maps/dir/?api=1&destination=' +
      encodeURIComponent(coordinates[1] + ',' + coordinates[0]) +
      '&travelmode=driving'
    : null
  const routeDistance = route?.distanceKm ?? task.distanceKm
  return (
    <article className={'dispatch-trip' + (done(task) ? ' is-finished' : '')}>
      <header>
        <div>
          <span className="dispatch-code">
            {task.direction === 'return' ? 'RETURN COLLECTION' : 'SHOP DELIVERY'} · #
            {String(task.rentalId).slice(-6).toUpperCase()}
          </span>
          <h3>{task.shop}</h3>
          <p>{task.titles.join(', ')}</p>
        </div>
        <span className="dispatch-status">{labels[task.status] || task.status}</span>
      </header>
      <div className="dispatch-addresses">
        <div>
          <small>Pickup</small>
          <b>{task.pickup.address || 'Saved map location'}</b>
        </div>
        <UiIcon name="truck" size={22} />
        <div>
          <small>Destination</small>
          <b>{task.destination.address || 'Saved map location'}</b>
        </div>
      </div>
      <div className="dispatch-meta">
        <span>
          {routeDistance == null
            ? 'Driving route not calculated'
            : routeDistance.toFixed(2) + ' km driving'}
        </span>
        <span>
          {(route?.etaMinutes ?? task.etaMinutes) == null
            ? 'Travel estimate unavailable'
            : 'About ' + (route?.etaMinutes ?? task.etaMinutes) + ' min'}
        </span>
        <b>Booked delivery fee {money(task.fee || 0)}</b>
      </div>
      {task.partner && (
        <div className="dispatch-contact">
          <UiIcon name="truck" size={18} />
          <span>
            Assigned partner: <b>{task.partner.name}</b>
          </span>
          {task.partner.phone ? (
            <a href={'tel:' + task.partner.phone.replace(/[^+\d]/g, '')}>{task.partner.phone}</a>
          ) : (
            <small>No phone saved</small>
          )}
        </div>
      )}
      {!task.ready && task.direction === 'delivery' && (
        <p className="dispatch-hint">
          {task.paid
            ? 'Waiting for shop preparation before collection.'
            : 'Payment must be recorded before collection.'}
        </p>
      )}
      <div className="dispatch-actions">
        {task.status === 'available' && role === 'delivery_partner' && (
          <>
            <button
              className="dispatch-primary"
              disabled={Boolean(busy)}
              onClick={() => action(task.id, () => post(base + '/accept'))}
            >
              Accept request
            </button>
            <button
              disabled={Boolean(busy)}
              onClick={() => action(task.id, () => post(base + '/decline'))}
            >
              Decline
            </button>
          </>
        )}
        {task.canManage && task.direction === 'delivery' && !task.ready && !done(task) && (
          <button
            disabled={Boolean(busy) || !task.paid}
            onClick={() => action(task.id, () => post(base + '/ready'))}
          >
            Mark shop items ready
          </button>
        )}
        {task.canOperate && next && (
          <button
            disabled={Boolean(busy)}
            onClick={() =>
              action(task.id, () =>
                api('/api/delivery/' + base + '/status', {
                  method: 'PATCH',
                  body: JSON.stringify({ status: next[0] }),
                }),
              )
            }
          >
            {next[1]}
          </button>
        )}
        {task.canOperate && kind && (
          <button
            className="dispatch-primary"
            disabled={Boolean(busy) || (kind === 'shop_pickup' && (!task.paid || !task.ready))}
            onClick={() => action(task.id, () => post(base + '/otp/send', { kind }))}
          >
            {challenge
              ? 'Resend ' + actionLabel.toLowerCase() + ' code'
              : actionLabel + ' · send OTP'}
          </button>
        )}
        {navigate && (
          <a className="dispatch-link" href={navigate} target="_blank" rel="noreferrer">
            Open navigation
          </a>
        )}
        <button
          disabled={Boolean(busy)}
          onClick={() => {
            setMapOpen(!mapOpen)
          }}
        >
          {' '}
          {mapOpen ? 'Hide map' : 'View map'}{' '}
        </button>
      </div>
      {challenge && (
        <div className="dispatch-challenge">
          <p>
            Code sent to {challenge.maskedEmail}. Expires {time(challenge.expiresAt)}.
          </p>
          <p>
            {kind === 'shop_return'
              ? 'The partner receives this code. The authorized shop owner or administrator must enter it after physical receipt and inspection.'
              : 'The email recipient provides this code to the assigned partner at the handover.'}
          </p>
          {canVerify && (
            <form
              key={challenge.id}
              onSubmit={(event) => {
                event.preventDefault()
                const values = new FormData(event.currentTarget)
                action(task.id, () =>
                  post(base + '/otp/verify', {
                    kind,
                    challengeId: challenge.id,
                    code: String(values.get('code') || ''),
                    inspectionNote: values.get('inspectionNote'),
                  }),
                )
              }}
            >
              <label>
                Six-digit handover code
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  placeholder="000000"
                  disabled={Boolean(busy)}
                />
              </label>
              {kind === 'shop_return' && (
                <label>
                  Return inspection
                  <textarea
                    name="inspectionNote"
                    minLength={5}
                    maxLength={1000}
                    required
                    placeholder="Condition of the returned items"
                  />
                </label>
              )}
              <button className="dispatch-primary" disabled={Boolean(busy)}>
                {busy === task.id ? 'Verifying…' : 'Verify handover'}
              </button>
            </form>
          )}
        </div>
      )}
      {mapOpen && (
        <div className="dispatch-map">
          <GeoapifyMap
            markers={[
              { id: 'pickup', kind: 'shop', location: task.pickup.location, title: 'Pickup' },
              { id: 'destination', location: task.destination.location, title: 'Destination' },
            ]}
            routeGeometry={route?.routeGeometry}
          />
          <button
            disabled={Boolean(busy)}
            onClick={() =>
              action(task.id, async () => {
                const result = await api('/api/delivery/' + base + '/route')
                setRoute(result)
                return { message: 'Driving route updated.' }
              })
            }
          >
            Calculate driving route
          </button>
        </div>
      )}
      <details className="dispatch-history">
        <summary>Handover timeline</summary>
        <ol>
          {task.history.map((entry, index) => (
            <li key={index}>
              <b>{labels[entry.status] || entry.status}</b>
              <time>{time(entry.at)}</time>
            </li>
          ))}
        </ol>
      </details>
    </article>
  )
}
