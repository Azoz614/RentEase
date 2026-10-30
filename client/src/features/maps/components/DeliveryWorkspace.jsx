import { useDeliveryRefresh } from '../../delivery-partner/hooks/useDeliveryEvents.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import GeoapifyMap from './GeoapifyMap.jsx'

import { TaskCard } from './TaskCard.jsx'
import { stages, label } from '../utils/deliveryStages.js'

export function DeliveryWorkspace({ api, role, hideWhenEmpty = false }) {
  const [data, setData] = useState({ tasks: [], shops: [] }),
    [error, setError] = useState(''),
    [type, setType] = useState('all'),
    [status, setStatus] = useState('all'),
    [loading, setLoading] = useState(true)
  const requestSequence = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++requestSequence.current
    try {
      const result = await api('/api/locations/tasks')
      if (!Array.isArray(result.tasks) || !Array.isArray(result.shops))
        throw new Error('Delivery updates could not be loaded. Refresh to try again.')
      if (current === requestSequence.current) {
        setData(result)
        setError('')
      }
    } catch (failure) {
      if (current === requestSequence.current) {
        setData({ tasks: [], shops: [] })
        setError(failure.message)
      }
    } finally {
      if (current === requestSequence.current) setLoading(false)
    }
  }, [api])
  useEffect(() => {
    refresh()
    const timer = setInterval(() => {
      if (!document.hidden) refresh()
    }, 15000)
    return () => clearInterval(timer)
  }, [refresh])
  useDeliveryRefresh(refresh)
  const tasks = data.tasks.filter(
    (task) =>
      (type === 'all' || task.type === type) && (status === 'all' || task.status === status),
  )
  const markers = [
    ...data.shops.map((shop) => ({
      id: shop._id,
      location: shop.shopLocation,
      kind: 'shop',
      title: shop.shopName || shop.username,
    })),
    ...tasks.flatMap((task) => [
      {
        id: `destination-${task.rentalId}-${task.productId}`,
        location: task.destination?.location,
        kind: task.type === 'return' ? 'return' : 'destination',
        title: `${task.title}: ${label(task.status)}`,
      },
      ...(task.live && new Date(task.live.expiresAt) > new Date()
        ? [
            {
              id: `partner-${task.rentalId}-${task.productId}`,
              location: task.live.location,
              kind: 'partner',
              title: task.partner?.name || 'Sharing partner',
            },
          ]
        : []),
    ]),
  ]
  if (hideWhenEmpty && !loading && !data.tasks.length && !error) return null
  return (
    <section className="re-map-panel">
      <h2>Delivery & return tracking</h2>
      <p>Only authorized active tasks appear here. Updates refresh every 15 seconds.</p>
      <div className="re-map-actions">
        <select
          aria-label="Task type"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="all">All task types</option>
          <option value="delivery">Deliveries</option>
          <option value="return">Returns</option>
        </select>
        <select
          aria-label="Delivery status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="all">All stages</option>
          {stages.map((stage) => (
            <option key={stage} value={stage}>
              {label(stage)}
            </option>
          ))}
        </select>
        <button type="button" onClick={refresh}>
          Refresh
        </button>
      </div>
      {role === 'admin' && (
        <>
          <GeoapifyMap markers={markers} />
          <small>
            Blue: shops · Orange: destinations · Green: sharing partners · Purple: returns
          </small>
        </>
      )}
      {error && (
        <p role="alert" className="re-map-error">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading delivery tasks…</p>
      ) : tasks.length ? (
        tasks.map((task) => (
          <TaskCard
            key={`${task.rentalId}-${task.productId}`}
            api={api}
            task={task}
            role={role}
            refresh={refresh}
          />
        ))
      ) : (
        <p>No active tasks match these filters.</p>
      )}
    </section>
  )
}
