import { useCallback, useEffect, useRef, useState } from 'react'
import { geoPoint } from '../utils/coordinates.js'

export function LiveSharing({ api, task, onRefresh }) {
  const [sharing, setSharing] = useState(false),
    [error, setError] = useState('')
  const watch = useRef(null),
    last = useRef(0),
    stopped = useRef(true),
    generation = useRef(0),
    pending = useRef(Promise.resolve()),
    stopRef = useRef(null)
  const url = `/api/locations/tasks/${task.rentalId}/${task.productId}/sharing`
  const stop = useCallback(() => {
    stopped.current = true
    generation.current++
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current)
    watch.current = null
    setSharing(false)
    // Queue stop after the last in-flight update so a late PUT cannot revive sharing.
    pending.current = pending.current
      .catch(() => {})
      .then(() =>
        api(url, { method: 'PUT', body: JSON.stringify({ enabled: false }), keepalive: true }),
      )
      .then(() => onRefresh())
      .catch(() => {})
  }, [api, url, onRefresh])
  stopRef.current = stop
  useEffect(
    () => () => {
      if (!stopped.current) stopRef.current?.()
    },
    [],
  )
  useEffect(() => {
    if (!task.canShare && !stopped.current) stop()
  }, [task.canShare, stop])
  useEffect(() => {
    const hide = () => {
      if (document.hidden && !stopped.current) stop()
    }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [stop])
  useEffect(() => {
    const leave = () => {
      if (!stopped.current) stop()
    }
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [stop])
  const start = () => {
    if (!navigator.geolocation) {
      setError('This browser cannot share location.')
      return
    }
    stopped.current = false
    const current = ++generation.current
    last.current = 0
    setError('')
    setSharing(true)
    watch.current = navigator.geolocation.watchPosition(
      (result) => {
        if (stopped.current || current !== generation.current || Date.now() - last.current < 15000)
          return
        last.current = Date.now()
        pending.current = pending.current
          .catch(() => {})
          .then(async () => {
            if (stopped.current || current !== generation.current) return
            await api(url, {
              method: 'PUT',
              body: JSON.stringify({
                enabled: true,
                location: geoPoint(result.coords.latitude, result.coords.longitude),
                accuracy: result.coords.accuracy,
              }),
            })
            onRefresh()
          })
          .catch((failure) => {
            setError(failure.message)
            stopRef.current?.()
          })
      },
      () => {
        setError('Location permission was denied, revoked, or unavailable. Sharing stopped.')
        stopRef.current?.()
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
  }
  return (
    <div>
      <button type="button" onClick={sharing ? stop : start} disabled={!sharing && !task.canShare}>
        {sharing ? 'Stop sharing location' : 'Start sharing location'}
      </button>
      <p>
        <small>
          With your permission, this active task shares your location with its customer, shop and
          administrators. Sharing stops when you leave or hide this page; mobile background tracking
          is not supported. Stale positions disappear after 90 seconds.
        </small>
      </p>
      {error && (
        <p role="alert" className="re-map-error">
          {error}
        </p>
      )}
    </div>
  )
}
