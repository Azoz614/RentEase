import { formatCurrencyFixed as money } from '../../../utils/currency.js'
import { useEffect, useRef, useState } from 'react'
import GeoapifyMap from './GeoapifyMap.jsx'
import { geoPoint, position } from '../utils/coordinates.js'

import { LiveSharing } from './LiveSharing.jsx'
import { label } from '../utils/deliveryStages.js'

export function TaskCard({ api, task, role, refresh }) {
  const [route, setRoute] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [partners, setPartners] = useState(null),
    [partner, setPartner] = useState(''),
    [open, setOpen] = useState(false)
  const base = `/api/locations/tasks/${task.rentalId}/${task.productId}`
  const routeSequence = useRef(0)
  useEffect(() => {
    routeSequence.current++
    setRoute(null)
  }, [task.type, task.status])
  const action = async (run) => {
    setBusy(true)
    setError('')
    try {
      await run()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  const live = task.live && new Date(task.live.expiresAt).getTime() > Date.now() ? task.live : null
  const markers = [
    {
      id: 'shop',
      kind: 'shop',
      location: task.shipment?.origin,
      title: task.shipment?.shopName || 'Pickup shop',
    },
    {
      id: 'destination',
      kind: task.type === 'return' ? 'return' : 'destination',
      location: task.destination?.location,
      title: task.type === 'return' ? 'Return collection' : 'Delivery destination',
    },
    ...(live
      ? [
          {
            id: 'partner',
            kind: 'partner',
            location: live.location,
            title: 'Shared delivery partner location',
          },
        ]
      : []),
  ]
  const destination = position(
    task.type === 'return' ? task.shipment?.origin : task.destination?.location,
  )
  const navigationDestination = position(
    ['assigned', 'heading_to_shop', 'arrived_at_shop'].includes(task.status)
      ? task.shipment?.origin
      : ['return_pickup', 'heading_to_customer'].includes(task.status)
        ? task.destination?.location
        : task.type === 'return'
          ? task.shipment?.origin
          : task.destination?.location,
  )
  const calculate = (fromDevice = false) =>
    action(async () => {
      const current = ++routeSequence.current
      let origin
      if (fromDevice) {
        if (!navigator.geolocation) throw new Error('This browser does not support location.')
        const result = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            resolve,
            () =>
              reject(new Error('Location permission was denied or your position is unavailable.')),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
          ),
        )
        origin = geoPoint(result.coords.latitude, result.coords.longitude)
      }
      const result = await api(`${base}/route`, {
        method: 'POST',
        body: JSON.stringify(origin ? { origin } : {}),
      })
      if (current === routeSequence.current) setRoute(result)
    })
  const next = task.nextStatus
  return (
    <article className="re-map-task">
      <h3>{task.title}</h3>
      <small>
        Order {String(task.rentalId).slice(-7).toUpperCase()} ·{' '}
        {task.type === 'return' ? 'Return collection' : 'Delivery'}
      </small>
      <p>
        <span className="re-map-status">{label(task.status)}</span> ·{' '}
        {task.partner?.name || 'No partner assigned'}
          {task.partner?.phone && <> · <a href={'tel:' + task.partner.phone.replace(/[^+\d]/g, '')}>{task.partner.phone}</a></>}
      </p>
      <p>
        <b>Shop:</b> {task.shipment?.shopName || 'Location unavailable'} ·{' '}
        {task.shipment?.shopAddress}
        <br />
        <b>Customer:</b> {task.destination?.address || 'Address unavailable'}
      </p>
      {task.shipment && (
        <p>
          {Number.isFinite(task.shipment.distanceKm)
            ? `${task.shipment.distanceKm.toFixed(2)} km booked driving distance`
            : 'Booked driving distance unavailable'}{' '}
          · Delivery {money(task.shipment.fee)} · Return {money(task.shipment.returnFee)}
          {task.shipment.returnDistanceKm != null && (
            <> · {task.shipment.returnDistanceKm.toFixed(2)} km return driving distance</>
          )}
        </p>
      )}
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide map' : 'View delivery map'}
      </button>
      {open && (
        <>
          <GeoapifyMap markers={markers} routeGeometry={route?.routeGeometry} />
          <p>
            {live ? (
              <span className="re-live">
                Location shared · received {new Date(live.updatedAt).toLocaleTimeString()} ·
                accuracy ±{Math.round(live.accuracy)} m
              </span>
            ) : (
              'Live location unavailable or sharing stopped.'
            )}
          </p>
          <div className="re-map-actions">
            <button
              type="button"
              disabled={busy || !destination || !task.shipment?.origin}
              onClick={() => calculate()}
            >
              {busy ? 'Loading…' : 'Calculate shop / customer route'}
            </button>
            {role === 'delivery_partner' && task.canShare && (
              <button
                type="button"
                disabled={busy || !navigationDestination}
                onClick={() => calculate(true)}
              >
                Route from my current location
              </button>
            )}
            {role === 'delivery_partner' && navigationDestination && (
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${navigationDestination.lat},${navigationDestination.lng}&travelmode=driving`}
                target="_blank"
                rel="noreferrer"
              >
                Open Google Maps navigation
              </a>
            )}
          </div>
          {route && (
            <p className="re-map-attribution">
              Powered by{' '}
              <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">
                Geoapify
              </a>{' '}
              · {route.distanceKm.toFixed(2)} km · estimated trip time {route.etaMinutes} min. This
              route does not change the booked fee.
            </p>
          )}
        </>
      )}
      {role === 'delivery_partner' && (
        <>
          {task.workflowVersion === 2
            ? <small>Your location is shared on this assigned trip while you are online in the delivery workspace.</small>
            : <LiveSharing api={api} task={task} onRefresh={refresh} />}
          {next && task.workflowVersion !== 2 && (
            <button
              type="button"
              disabled={busy || Boolean(task.progressBlocked)}
              onClick={() =>
                action(async () => {
                  await api(
                    `/api/delivery/assignments/${task.rentalId}/items/${task.productId}/status`,
                    { method: 'PATCH', body: JSON.stringify({ status: next }) },
                  )
                  await refresh()
                })
              }
            >
              Mark {label(next)}
            </button>
          )}
          <p>
            <small>
              {task.progressBlocked ||
                'Rental pickup and return require administrator OTP verification.'}
            </small>
          </p>
        </>
      )}
      {role === 'admin' && task.canAssign && (
        <div className="re-map-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              action(async () => setPartners((await api(`${base}/partners`)).partners))
            }
          >
            Choose delivery partner
          </button>
          {partners && (
            <>
              <select
                aria-label="Eligible delivery partner"
                value={partner}
                onChange={(event) => setPartner(event.target.value)}
              >
                <option value="">Select active partner</option>
                {partners.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · {entry.activeTasks} active tasks ·{' '}
                    {entry.distanceKm == null
                      ? 'location unavailable'
                      : `${entry.distanceKm.toFixed(1)} km geographic proximity`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!partner || busy}
                onClick={() =>
                  action(async () => {
                    await api(`${base}/partner`, {
                      method: 'PATCH',
                      body: JSON.stringify({ partnerId: partner }),
                    })
                    setPartners(null)
                    await refresh()
                  })
                }
              >
                Assign partner
              </button>
              <small>
                Idle partners have no live location. Distances appear only for partners sharing on
                an active task; partners on other trips cannot be assigned.
              </small>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="re-map-error" role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
