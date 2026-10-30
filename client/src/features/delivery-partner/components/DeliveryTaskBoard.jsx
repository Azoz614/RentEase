import { useCallback, useEffect, useRef, useState } from 'react'
import PartnerAvailability from './PartnerAvailability.jsx'
import { useDeliveryRefresh } from '../hooks/useDeliveryEvents.js'
import DeliveryTrackingMap from '../../maps/components/DeliveryTrackingMap.jsx'
import { formatCurrencyFixed as money } from '../../../utils/currency.js'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import '../styles/delivery-dispatch.css'
import ReturnMethodDialog from '../../rentals/components/ReturnMethodDialog.jsx'
import { HandoverCodeInput } from '../../rentals/components/HandoverCodeInput.jsx'

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

export default function DeliveryTaskBoard({ api, role, onSummary, rentalId, onReturn, hideWhenEmpty = false }) {
  const [data, setData] = useState({ tasks: [], online: false }),
    [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [loadError, setLoadError] = useState('')
  const [returnRental, setReturnRental] = useState(null)
  const lifecycle = useRef({ mounted: false, sequence: 0 })
  const load = useCallback(async () => {
    if (!lifecycle.current.mounted) return
    const current = ++lifecycle.current.sequence
    try {
      const result = await api('/api/delivery/tasks')
      if (!lifecycle.current.mounted || current !== lifecycle.current.sequence) return
      if (!Array.isArray(result?.tasks)) throw new Error('Delivery updates could not load. Please refresh.')
      setData(result)
      setLoadError('')
      const owned = result.tasks.filter((t) => t.canOperate),
        active = owned.filter((t) => !done(t))
      onSummary?.({
        active: active.length,
        completed: owned.filter((t) => ['delivered', 'returned'].includes(t.status)).length,
        fee: active.reduce((sum, t) => sum + Number(t.fee || 0), 0),
        online: result.online,
      })
    } catch (failure) {
      if (lifecycle.current.mounted && current === lifecycle.current.sequence)
        setLoadError(failure.message)
    } finally {
      if (lifecycle.current.mounted && current === lifecycle.current.sequence) setLoading(false)
    }
  }, [api, onSummary])
  useEffect(() => {
    const state = lifecycle.current
    state.mounted = true
    queueMicrotask(() => {
      if (state.mounted) load()
    })
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
  const tasks = data.tasks.filter((t) => !rentalId || String(t.rentalId) === String(rentalId))
  const offers = tasks.filter((t) => t.status === 'available' && role === 'delivery_partner')
  const active = tasks.filter(
    (t) => !done(t) && !(role === 'delivery_partner' && t.status === 'available'),
  )
  const completed = tasks.filter(done).slice(0, 12)
  const returns =
    role === 'user'
      ? [
          ...new Map(
            tasks
              .filter((t) => t.rentalStatus === 'active' && !t.returnRequested)
              .map((t) => [t.rentalId, t]),
          ).values(),
        ]
      : []
  // Customers see finished trips inside each rental's details, not as a list here.
  const showCompleted = role !== 'user' && completed.length > 0
  // Pages that only sometimes have trips (My rentals) show nothing rather than an empty box.
  if (hideWhenEmpty && !loading && !loadError && !active.length && !returns.length && !showCompleted)
    return null
  return (
    <section className="dispatch-board" aria-label="Rental delivery and return handovers">
      {/* Riders already have the page title and a refresh button in the top bar. */}
      {role !== 'delivery_partner' && (
        <header className="dispatch-heading">
          <div>
            <h2>Delivery progress</h2>
          </div>
          <button type="button" onClick={load} aria-label="Refresh delivery requests">
            <UiIcon name="refresh" size={18} />
          </button>
        </header>
      )}
      {role === 'delivery_partner' && <PartnerAvailability api={api} onRefresh={load} />}
      {data.busy && role === 'delivery_partner' && !active.length && (
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
      {loading && <div role="status" aria-label="Loading delivery requests" className="dispatch-skeleton" />}
      {returns.map((task) => (
        <button
          className="dispatch-primary"
          key={task.rentalId}
          type="button"
          disabled={Boolean(busy)}
          onClick={() => onReturn ? onReturn(task) : setReturnRental({ _id: task.rentalId,
            returnMethod: task.returnMethod, deliveryDestination: task.destination })}
        >
          Return rental · #{String(task.rentalId).slice(-6).toUpperCase()}
        </button>
      ))}
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
      {role === 'delivery_partner' && (
        <section className="dispatch-offers">
          <h3>Requests near you</h3>
          <p>Riders closest to the shop see a request first.</p>
          {!offers.length && !loading && (
            <p className="dispatch-empty">
              {data.busy
                ? 'New requests are paused while you have a trip in progress. Finish or release it to receive more.'
                : data.online
                  ? 'No requests near you right now. New ones appear here automatically.'
                  : 'Go online to start receiving requests.'}
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
      {showCompleted && (
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
      {returnRental && <ReturnMethodDialog rental={returnRental} api={api}
        onClose={() => setReturnRental(null)} onUpdated={load} />}
    </section>
  )
}

function Trip({ task, api, role, busy, action, post }) {
  const [route, setRoute] = useState(null),
    [mapOpen, setMapOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!task.live) return
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, new Date(task.live.expiresAt).getTime() - Date.now()) + 10,
    )
    return () => clearTimeout(timer)
  }, [task.live])
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
    shop_pickup: 'Hand items to rider',
    customer_delivery: 'Deliver product',
    customer_return: 'Hand return to rider',
    shop_return: 'Return to shop',
  }[kind]
  const challenge = task.challenge?.kind === kind ? task.challenge : null
  const canVerify = task.canVerifyOtp
  const [clock, setClock] = useState(() => Date.now())
  const challengeId = challenge?.id
  useEffect(() => {
    if (!challengeId) return
    const timer = setInterval(() => setClock(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [challengeId])
  const expiresIn = challenge ? Math.max(0, Math.ceil((new Date(challenge.expiresAt) - clock) / 1000)) : 0
  const resendIn = challenge ? Math.max(0, Math.ceil((new Date(challenge.resendAt) - clock) / 1000)) : 0
  const [confirmRelease, setConfirmRelease] = useState(false)
  // Before the rider holds the items, the trip can be handed back so the booking is not stuck.
  const releasable = Boolean(task.partner) && (task.direction === 'delivery'
    ? ['assigned', 'heading_to_shop', 'arrived_at_shop'] : ['return_pickup', 'heading_to_customer']).includes(task.status)
  const searching = task.status === 'available' && task.search?.state === 'searching'
  const waiting = task.status === 'available' && (!task.search?.state || task.search.state === 'waiting')
  const exhausted = task.status === 'available' && task.search?.state === 'exhausted'
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
  const live = task.live && new Date(task.live.expiresAt).getTime() > now ? task.live : null
  return (
    <article className={'dispatch-trip' + (done(task) ? ' is-finished' : '')}>
      <header>
        <div>
          <span className="dispatch-code">
            {task.direction === 'return' ? 'RETURN COLLECTION' : 'SHOP DELIVERY'} · #
            {String(task.rentalId).slice(-6).toUpperCase()}
          </span>
          <h3>{task.titles.join(', ')}</h3>
          <p>{task.direction === 'return' ? 'Returning to' : 'From'} <b>{task.shop}</b></p>
        </div>
        <span className="dispatch-status">{waiting ? 'Ready to assign' : exhausted ? 'No rider accepted' : labels[task.status] || task.status}</span>
      </header>
      {task.otpNotice && <aside className="dispatch-private-code" role="status">
        <UiIcon name="shield" size={22} /><div><b>Private handover code · just for you</b><p>{task.otpNotice.body}</p></div>
      </aside>}
      {kind && !done(task) && <section className="dispatch-next-step" aria-label="Next handover">
        <span className="dispatch-next-icon"><UiIcon name="shield" size={23} /></span>
        <div><span className="workspace-kicker">NEXT HANDOVER</span>
          <h4>{task.canSendOtp ? actionLabel : ({ shop_pickup: 'Waiting for the shop handover', customer_delivery: 'Your delivery is on the way', customer_return: 'Waiting for the customer handover', shop_return: 'Waiting for the rider’s return' })[kind]}</h4>
          <p>{task.canSendOtp ? 'Send the recipient a private code. Enter the code they share after receiving the items.'
            : ({ shop_pickup: 'The shop sends your receipt code. Share it with the shop after receiving the items.', customer_delivery: 'The rider sends your receipt code. Share it after your items arrive.', customer_return: 'The customer sends the code to the rider, then verifies it after handing over the return.', shop_return: 'The rider sends the shop a receipt code and verifies it after the shop receives the items.' })[kind]}</p>
        </div>
      </section>}
      <div className="dispatch-actions">
        {role === 'user' && (waiting || exhausted) && <button className="dispatch-primary" disabled={Boolean(busy) || (task.direction === 'delivery' && !task.paid)}
          title={task.direction === 'delivery' && !task.paid ? 'Pay for the booking first' : undefined}
          onClick={() => action(task.id, () => post(task.direction === 'delivery'
            ? 'rentals/' + task.rentalId + '/assign' : base + '/search'))}>
          <UiIcon name="truck" size={17} /> {exhausted ? 'Search for riders again' : 'Assign delivery partner'}
        </button>}
        {role === 'user' && task.direction === 'return' && task.status === 'available' && (
          <button disabled={Boolean(busy)}
            onClick={() => action(task.id, () => post('rentals/' + task.rentalId + '/return/cancel'))}>
            Cancel collection · return it myself
          </button>
        )}
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
        {releasable && (task.canOperate || task.canManage) && (
          confirmRelease ? (
            <span className="dispatch-confirm" role="group" aria-label="Confirm releasing this trip">
              <span>{task.canOperate ? 'Release this trip? Another rider will be found.' : 'Remove this rider and find another?'}</span>
              <button className="dispatch-danger" disabled={Boolean(busy)}
                onClick={() => action(task.id, () => post(base + '/release'))}>
                Yes, release
              </button>
              <button disabled={Boolean(busy)} onClick={() => setConfirmRelease(false)}>Keep</button>
            </span>
          ) : (
            <button disabled={Boolean(busy)} onClick={() => setConfirmRelease(true)}>
              {task.canOperate ? 'Can’t make it? Release trip' : 'Find another rider'}
            </button>
          )
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
        {task.canSendOtp && kind && (
          <button
            className="dispatch-primary"
            disabled={Boolean(busy) || resendIn > 0 || (kind === 'shop_pickup' && (!task.paid || !task.ready))}
            onClick={() => action(task.id, () => post(base + '/otp/send', { kind }))}
          >
            {resendIn > 0 ? `Resend in ${resendIn}s` : challenge
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
          <div className="dispatch-challenge-heading"><UiIcon name="shield" size={20} /><b>Verify the recipient’s code</b><span>Single use</span></div>
          <p>
            Code sent to {challenge.maskedEmail}. {expiresIn > 0 ? `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, '0')} remaining` : 'Code expired · request a new code.'}
          </p>
          <p>
            The recipient receives the code by email and private notification. Ask for it after handing over the items.
          </p>
          {canVerify && expiresIn > 0 && (
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
                <HandoverCodeInput
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
                    disabled={Boolean(busy)}
                    placeholder="Condition of the returned items (optional)"
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
      <ol className="dispatch-stepper" aria-label="Delivery progress">
        {(task.direction === 'return' ? ['Rider assigned', 'Collected', 'Returning', 'Shop received']
          : ['Rider assigned', 'Shop collected', 'On the way', 'Delivered']).map((label, index) => {
          const stage = task.direction === 'return'
            ? ['return_pickup', 'collected', 'returning', 'returned']
            : ['assigned', 'picked_up', 'on_the_way', 'delivered']
          const current = ['heading_to_shop', 'arrived_at_shop', 'heading_to_customer'].includes(task.status)
            ? 0 : stage.indexOf(task.status)
          return <li key={label} className={current >= index ? 'is-complete' : ''}
            aria-current={current === index ? 'step' : undefined}>{label}</li>
        })}
      </ol>
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
        <b>{role === 'delivery_partner' ? 'Trip fee' : 'Booked delivery fee'} {money(task.fee || 0)}</b>
      </div>
      {task.partner && role !== 'delivery_partner' && (
        <div className="dispatch-contact">
          <span className="dispatch-avatar" aria-hidden="true">{task.partner.name.slice(0, 1).toUpperCase()}</span>
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
      {role === 'delivery_partner' && task.contacts && <div className="dispatch-job-contacts">
        {Object.entries(task.contacts).map(([key, contact]) => contact && <div className="dispatch-contact" key={key}>
          <span><small>{key === 'shop' ? 'Shop contact' : 'Customer contact'}</small><b>{contact.name}</b></span>
          {contact.phone && <a href={'tel:' + contact.phone.replace(/[^+\d]/g, '')}>{contact.phone}</a>}
        </div>)}
      </div>}
      {searching && role !== 'delivery_partner' && <div className="dispatch-search" role="status">
        <span className="dispatch-radar"><UiIcon name="truck" size={24} /></span>
        <div><b>Finding nearby riders</b><p>{task.search.radiusMeters >= 20000000 ? 'Checking all remaining available riders' : `Searching within ${task.search.radiusMeters / 1000} km of pickup`} · we’ll expand automatically.</p></div>
      </div>}
      {exhausted && <p role="status" className="dispatch-hint">No available rider accepted this time. You can start another search.</p>}
      {!task.ready && task.direction === 'delivery' && role !== 'delivery_partner' && (
        <p className="dispatch-hint">
          {task.paid
            ? 'Waiting for shop preparation before collection.'
            : 'Payment must be recorded before collection.'}
        </p>
      )}
      {mapOpen && (
        <div className="dispatch-map">
          <DeliveryTrackingMap
            markers={[
              { id: 'pickup', kind: 'shop', location: task.pickup.location, title: 'Pickup' },
              { id: 'destination', location: task.destination.location, title: 'Destination' },
              ...(live
                ? [
                    {
                      id: 'partner',
                      kind: 'partner',
                      location: live.location,
                      title: task.partner?.name || 'Assigned partner',
                    },
                  ]
                : []),
            ]}
            routeGeometry={route?.routeGeometry}
          />
          {task.partner && !done(task) && (
            <p role="status" className={live ? 're-live' : 'dispatch-hint'}>
              {live
                ? 'Partner location updated ' +
                  time(live.updatedAt) +
                  ' · accuracy ±' +
                  Math.round(live.accuracy) +
                  ' m'
                : 'Live partner location unavailable. The assigned partner must be online with location permission.'}
            </p>
          )}
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
        {task.verifications?.length > 0 && <ol className="dispatch-verification-records" aria-label="Verified handovers">
          {task.verifications.map((v, index) => <li key={index}><b>{v.kind.replaceAll('_', ' ')} verified</b><time>{time(v.at)}</time>
            {v.senderId && <small>Sender: {v.senderName || v.senderId} · Recipient: {v.recipientName || v.recipientId} · Verifier: {v.verifierName || v.verifiedBy}</small>}
          </li>)}
        </ol>}
      </details>
    </article>
  )
}
