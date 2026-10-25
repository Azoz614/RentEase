import { useCallback, useEffect, useRef, useState } from 'react'
import { geoPoint } from '../../maps/utils/coordinates.js'

export default function PartnerAvailability({ api, onRefresh }) {
  const [online, setOnline] = useState(false),
    [starting, setStarting] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const watch = useRef(null),
    timer = useRef(null),
    stopped = useRef(true),
    generation = useRef(0),
    last = useRef(0),
    freshAt = useRef(0)
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
    setNotice('')
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
    if (window.isSecureContext === false) {
      setError('Location needs a secure connection. Open RentEase using HTTPS, or localhost when developing on this computer.')
      return
    }
    if (!navigator.geolocation) {
      setError('Location is not available in this browser. Open RentEase in a browser with location access enabled.')
      return
    }
    stopped.current = false
    const current = ++generation.current
    setStarting(true)
    setError('')
    setNotice('')
    last.current = 0
    freshAt.current = 0
    let locating = false
    let heartbeat = 0
    const active = () => !stopped.current && current === generation.current
    const fail = (message) => {
      if (!active()) return
      setError(message)
      stopRef.current?.()
    }
    const locationMessage = (failure) => failure?.code === 1
      ? 'Location access is blocked. Allow Location in this site’s browser settings and enable location services on your device, then try Go online again.'
      : failure?.code === 3
        ? 'Your location request timed out. Check your connection and device location services, then try Go online again.'
        : 'Your device could not determine its location. Enable device location services, check your Wi-Fi or mobile connection, and try Go online again.'
    const publish = (result) => {
      if (!active()) return false
      const { latitude, longitude, accuracy } = result.coords || {}
      const timestamp = result.timestamp
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
        !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
        !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 5000 ||
        !Number.isFinite(timestamp) || timestamp > Date.now() + 5000 || Date.now() - timestamp > 60000) return false
      freshAt.current = Math.max(freshAt.current, timestamp)
      setNotice('')
      if (Date.now() - last.current < 15000) return true
      last.current = Date.now()
      pending.current = pending.current
        .catch(() => {})
        .then(async () => {
          if (!active() || Date.now() - timestamp > 60000) return
          await api('/api/delivery/presence', {
            method: 'PUT',
            body: JSON.stringify({
              online: true,
              location: geoPoint(latitude, longitude),
              accuracy,
            }),
          })
          if (current === generation.current) {
            setOnline(true)
            setStarting(false)
            onRefresh?.()
          }
        })
        .catch((failure) => {
          if (current === generation.current) {
            setError(failure.message)
            stopRef.current?.()
          }
        })
      return true
    }
    const requestPosition = (highAccuracy = false) => {
      if (!active() || locating) return
      locating = true
      navigator.geolocation.getCurrentPosition((result) => {
        locating = false
        if (!active()) return
        if (publish(result)) {
          if (watch.current === null) {
            watch.current = navigator.geolocation.watchPosition((position) => {
              if (!active()) return
              if (!publish(position)) {
                setNotice('Waiting for a more accurate, fresh location. Retrying automatically.')
                requestPosition()
              }
            }, (failure) => {
              if (!active()) return
              if (failure?.code === 1) { fail(locationMessage(failure)); return }
              setNotice('Location update interrupted. Retrying while your last position is still fresh.')
              requestPosition()
            }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 })
          }
          return
        }
        if (!highAccuracy) { requestPosition(true); return }
        if (!freshAt.current) fail('A fresh location accurate to within 5 km is needed to go online. Enable device location services and try again.')
        else setNotice('Waiting for a more accurate, fresh location. Retrying automatically.')
      }, (failure) => {
        locating = false
        if (!active()) return
        if (failure?.code === 1) { fail(locationMessage(failure)); return }
        if (!highAccuracy && !freshAt.current) {
          setNotice('Your location is taking longer than usual. Trying another location request…')
          requestPosition(true)
        } else if (!freshAt.current) fail(locationMessage(failure))
        else setNotice('Location update interrupted. Retrying while your last position is still fresh.')
      }, { enableHighAccuracy: highAccuracy, maximumAge: highAccuracy ? 0 : 15000,
        timeout: highAccuracy ? 30000 : 20000 })
    }
    timer.current = setInterval(() => {
      if (!active()) return
      if (freshAt.current && Date.now() - freshAt.current >= 75000) {
        fail('Location updates have stopped, so you are now offline. Check device location services and try Go online again.')
        return
      }
      if (++heartbeat % 6 === 0) requestPosition()
    }, 5000)
    requestPosition()
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
          With your permission, availability uses your device’s current location. On an assigned trip it also updates tracking for its customer, shop and administrators. It stops when this page
          is hidden or closed; stale positions expire after 90 seconds.
        </p>
      </div>
      <button type="button" onClick={online || starting ? stop : start}>
        {online || starting ? 'Go offline' : 'Go online'}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <div>
          <p role="alert" className="re-map-error">{error}</p>
          <details>
            <summary>Help with location access</summary>
            <p>In your browser’s site settings, set Location to Allow. In Windows Settings, open Privacy &amp; security → Location and enable location services and access for desktop apps. On a phone, enable Location in device settings. Reload RentEase and try again.</p>
            <p>Use HTTPS for a deployed site. When testing on this computer, use localhost; an HTTP address on your local network cannot request browser location.</p>
          </details>
        </div>
      )}
    </section>
  )
}
