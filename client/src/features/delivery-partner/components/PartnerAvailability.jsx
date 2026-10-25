import { useCallback, useEffect, useRef, useState } from 'react'
import { geoPoint } from '../../maps/utils/coordinates.js'

export default function PartnerAvailability({ api, onRefresh }) {
  const [online, setOnline] = useState(false),
    [starting, setStarting] = useState(false),
    [error, setError] = useState('')
  const watch = useRef(null),
    timer = useRef(null),
    stopped = useRef(true),
    generation = useRef(0),
    last = useRef(0)
  const pending = useRef(Promise.resolve()),
    stopRef = useRef(null)
  const stop = useCallback(() => {
    stopped.current = true
    generation.current++
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current)
    clearInterval(timer.current)
    watch.current = null
    setOnline(false)
    setStarting(false)
    pending.current = pending.current
      .catch(() => {})
      .then(() =>
        api('/api/delivery/presence', {
          method: 'PUT',
          body: JSON.stringify({ online: false }),
          keepalive: true,
        }),
      )
      .then(onRefresh)
      .catch(() => {})
  }, [api, onRefresh])
  useEffect(() => { stopRef.current = stop }, [stop])
  useEffect(() => {
    const hide = () => {
      if (document.hidden && !stopped.current) stopRef.current?.()
    }
    const leave = () => {
      if (!stopped.current) stopRef.current?.()
    }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('pagehide', leave)
      leave()
    }
  }, [])
  const start = () => {
    if (!navigator.geolocation) {
      setError('This browser cannot provide your current location.')
      return
    }
    stopped.current = false
    const current = ++generation.current
    setStarting(true)
    setError('')
    last.current = 0
    const failed = () => {
      if (current !== generation.current) return
      setError(
        'Location permission was denied or a fresh GPS position is unavailable. Availability has stopped.',
      )
      stopRef.current?.()
    }
    const publish = (result) => {
      if (stopped.current || current !== generation.current || Date.now() - last.current < 15000)
        return
      last.current = Date.now()
      pending.current = pending.current
        .catch(() => {})
        .then(async () => {
          if (stopped.current || current !== generation.current) return
          await api('/api/delivery/presence', {
            method: 'PUT',
            body: JSON.stringify({
              online: true,
              location: geoPoint(result.coords.latitude, result.coords.longitude),
              accuracy: result.coords.accuracy,
            }),
          })
          if (current === generation.current) {
            setOnline(true)
            setStarting(false)
            onRefresh()
          }
        })
        .catch((failure) => {
          if (current === generation.current) {
            setError(failure.message)
            stopRef.current?.()
          }
        })
    }
    const options = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    watch.current = navigator.geolocation.watchPosition(publish, failed, options)
    timer.current = setInterval(
      () => navigator.geolocation.getCurrentPosition(publish, failed, options),
      30000,
    )
  }
  return (
    <section className="dispatch-availability">
      <div>
        <b>
          {online
            ? 'Online for nearby requests'
            : starting
              ? 'Getting your current location…'
              : 'You are offline'}
        </b>
        <p>
          With your permission, availability uses your current GPS position. On an assigned trip it also updates tracking for its customer, shop and administrators. It stops when this page
          is hidden or closed; stale positions expire after 90 seconds.
        </p>
      </div>
      <button type="button" onClick={online || starting ? stop : start}>
        {online || starting ? 'Go offline' : 'Go online'}
      </button>
      {error && (
        <p role="alert" className="re-map-error">
          {error}
        </p>
      )}
    </section>
  )
}
