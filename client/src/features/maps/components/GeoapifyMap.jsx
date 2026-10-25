import { position, geoPoint } from '../utils/coordinates.js'

import { useEffect, useRef, useState } from 'react'
import 'leaflet/dist/leaflet.css'
import { geoapifyBrowserKey } from '../api/geoapify.js'
import '../styles/maps.css'

const colors = { shop: '#315bd6', destination: '#c46120', partner: '#16864e', return: '#8d4dc4' }
let library
const loadLeaflet = () =>
  (library ||= import('leaflet')
    .then((module) => module.default || module)
    .catch((error) => {
      library = null
      throw error
    }))

export default function GeoapifyMap({ markers = [], onPin, onSelect, routeGeometry, selected }) {
  const container = useRef(null),
    map = useRef(null),
    leaflet = useRef(null),
    viewport = useRef(''),
    callbacks = useRef({ onPin, onSelect })
  const [ready, setReady] = useState(false),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    callbacks.current = { onPin, onSelect }
  }, [onPin, onSelect])
  useEffect(() => {
    const key = geoapifyBrowserKey()
    setReady(false)
    setError('')
    viewport.current = ''
    if (!key) {
      setError(
        'Maps need VITE_GEOAPIFY_API_KEY in client/.env. Add your Geoapify browser key and restart the frontend.',
      )
      return
    }
    let active = true,
      instance,
      tiles,
      observer
    loadLeaflet()
      .then((L) => {
        if (!active) return
        leaflet.current = L
        instance = L.map(container.current, {
          scrollWheelZoom: false,
          worldCopyJump: true,
        }).setView([7.87, 80.77], 7)
        map.current = instance
        tiles = L.tileLayer(
          `https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}${L.Browser.retina ? '@2x' : ''}.png?apiKey=${encodeURIComponent(key)}`,
          {
            maxZoom: 20,
            attribution:
              'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
          },
        )
        tiles.on('tileerror', () => {
          if (active)
            setError(
              'Geoapify map tiles could not load. Check the browser key, allowed websites, quota and your connection.',
            )
        })
        tiles.on('tileload', () => {
          if (active) setError('')
        })
        tiles.addTo(instance)
        instance.on('click', (event) =>
          callbacks.current.onPin?.(geoPoint(event.latlng.lat, event.latlng.lng)),
        )
        observer =
          typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(() => instance.invalidateSize({ pan: false }))
        observer?.observe(container.current)
        setReady(true)
      })
      .catch(() => {
        if (active) setError('The map library could not load. Check your connection and retry.')
      })
    return () => {
      active = false
      observer?.disconnect()
      tiles?.off()
      instance?.remove()
      map.current = null
    }
  }, [attempt])

  const markerData = JSON.stringify(markers)
  useEffect(() => {
    if (!ready || !map.current) return
    const L = leaflet.current,
      instance = map.current,
      entries = JSON.parse(markerData).filter((entry) => position(entry.location)),
      group = L.layerGroup().addTo(instance)
    const bounds = L.latLngBounds([])
    for (const entry of entries) {
      const icon = L.divIcon({
        className: 're-leaflet-marker',
        html: `<span style="--pin-color:${colors[entry.kind] || colors.destination}" class="re-leaflet-pin${selected === entry.id ? ' is-selected' : ''}"></span>`,
        iconSize: [32, 40],
        iconAnchor: [16, 38],
        tooltipAnchor: [0, -34],
      })
      const marker = L.marker(position(entry.location), {
        icon,
        title: entry.title || 'Location',
        alt: entry.title || 'Location',
        draggable: Boolean(entry.draggable),
        autoPan: Boolean(entry.draggable),
        keyboard: true,
      }).addTo(group)
      const tooltip = document.createElement('span')
      tooltip.textContent = entry.title || 'Location'
      marker.bindTooltip(tooltip)
      marker.on('click', () => callbacks.current.onSelect?.(entry.id))
      if (entry.draggable)
        marker.on('dragend', () => {
          const location = marker.getLatLng()
          callbacks.current.onPin?.(geoPoint(location.lat, location.lng))
        })
      bounds.extend(marker.getLatLng())
    }
    const viewportKey = JSON.stringify([entries.map((entry) => entry.id).sort(), selected])
    if (viewport.current !== viewportKey || entries.some((entry) => entry.draggable)) {
      const focused = entries.find((entry) => entry.id === selected)
      if (focused) instance.setView(position(focused.location), 15, { animate: false })
      else if (entries.length === 1)
        instance.setView(position(entries[0].location), 14, { animate: false })
      else if (bounds.isValid())
        instance.fitBounds(bounds, { padding: [35, 35], maxZoom: 16, animate: false })
      viewport.current = viewportKey
    }
    return () => {
      group.clearLayers()
      group.remove()
    }
  }, [ready, attempt, markerData, selected])

  const geometryData = JSON.stringify(routeGeometry || null)
  useEffect(() => {
    if (!ready || !map.current || geometryData === 'null') return
    let line
    try {
      line = leaflet.current
        .geoJSON(JSON.parse(geometryData), { style: { color: '#315bd6', weight: 5, opacity: 0.9 } })
        .addTo(map.current)
      const bounds = line.getBounds()
      if (bounds.isValid()) map.current.fitBounds(bounds, { padding: [35, 35], animate: false })
    } catch {
      setError('The driving route could not be drawn. Recalculate the route to retry.')
    }
    return () => line?.remove()
  }, [ready, attempt, geometryData])

  return (
    <div className="re-map-frame">
      {!ready && !error && <p role="status">Loading map…</p>}
      {error && (
        <div role="alert" className="re-map-error">
          {error}{' '}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            Retry map
          </button>
        </div>
      )}
      <div ref={container} className="re-map" aria-label="Interactive location map" />
    </div>
  )
}
