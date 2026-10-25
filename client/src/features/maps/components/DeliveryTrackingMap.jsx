import { useEffect, useRef, useState } from 'react'
import GeoapifyMap from './GeoapifyMap.jsx'

let loader
function loadGoogleMaps(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve(window.google.maps)
  if (loader) return loader
  loader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    let timer
    const finish = (error) => {
      clearTimeout(timer)
      delete window.__rentEaseMapsReady
      if (error) { script.remove(); loader = null; reject(error) }
      else resolve(window.google.maps)
    }
    window.__rentEaseMapsReady = () => finish()
    script.src = 'https://maps.googleapis.com/maps/api/js?' + new URLSearchParams({
      key, loading: 'async', v: 'weekly', callback: '__rentEaseMapsReady',
    })
    script.async = true
    script.onerror = () => finish(new Error('Google Maps could not load.'))
    timer = setTimeout(() => finish(new Error('Google Maps took too long to load.')), 20000)
    document.head.appendChild(script)
  })
  return loader
}

export default function DeliveryTrackingMap(props) {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  return key ? <GoogleTrackingMap {...props} apiKey={key} /> : <GeoapifyMap {...props} />
}

function GoogleTrackingMap({ markers = [], routeGeometry, apiKey }) {
  const container = useRef(null), instance = useRef(null), library = useRef(null), viewport = useRef('')
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    loadGoogleMaps(apiKey).then(async (maps) => {
      const [mapLibrary, markerLibrary] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')])
      if (!active) return
      library.current = { ...mapLibrary, ...markerLibrary, LatLngBounds: maps.LatLngBounds }
      instance.current = new mapLibrary.Map(container.current, { center: { lat: 7.87, lng: 80.77 },
        zoom: 7, mapId: import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
        mapTypeControl: false, streetViewControl: false, gestureHandling: 'cooperative' })
      setReady(true)
    }).catch(() => { if (active) setError('Google Maps is unavailable. Retry or open navigation for directions.') })
    return () => { active = false; setReady(false); instance.current = null; viewport.current = '' }
  }, [apiKey, attempt])
  const markerData = JSON.stringify(markers)
  const routeData = JSON.stringify(routeGeometry)
  useEffect(() => {
    if (!ready || !instance.current) return
    const maps = library.current
    const parsed = JSON.parse(markerData)
    const bounds = new maps.LatLngBounds()
    const pins = parsed.filter((m) => Array.isArray(m.location?.coordinates)).map((m) => {
      const [lng, lat] = m.location.coordinates
      const position = { lat, lng }
      bounds.extend(position)
      const pin = new maps.PinElement({ background: m.kind === 'partner' ? '#497633' : m.kind === 'shop' ? '#315bd6' : '#c46120',
        borderColor: '#fff', glyphColor: '#fff', glyphText: m.kind === 'partner' ? 'R' : m.kind === 'shop' ? 'S' : 'C' })
      return new maps.AdvancedMarkerElement({ map: instance.current, position, title: m.title, content: pin.element })
    })
    const shape = routeData ? JSON.parse(routeData) : null
    const lines = shape?.type === 'MultiLineString' ? shape.coordinates : shape?.type === 'LineString' ? [shape.coordinates] : []
    const paths = lines.map((line) => new maps.Polyline({ map: instance.current,
      path: line.map(([lng, lat]) => ({ lat, lng })), strokeColor: '#497633', strokeWeight: 5, strokeOpacity: .85 }))
    const signature = JSON.stringify(parsed.filter((m) => m.kind !== 'partner').map((m) => m.location))
    if (signature !== viewport.current && pins.length) {
      viewport.current = signature
      instance.current.fitBounds(bounds, 44)
    }
    return () => { pins.forEach((p) => { p.map = null }); paths.forEach((p) => p.setMap(null)) }
  }, [ready, markerData, routeData])
  return <div className="re-map-panel">
    <div ref={container} style={{ height: 340, width: '100%', borderRadius: 14 }} role="region" aria-label="Google Maps delivery tracking" />
    {!ready && !error && <p role="status">Loading Google Maps…</p>}
    {error && <p role="alert" className="re-map-error">{error} <button onClick={() => { setError(''); setAttempt((n) => n + 1) }}>Retry map</button></p>}
  </div>
}
