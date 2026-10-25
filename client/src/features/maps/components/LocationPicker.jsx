import { useEffect, useId, useRef, useState } from 'react'
import { geoapifySearch } from '../api/geoapify.js'

import { position, geoPoint } from '../utils/coordinates.js'

import { MapAttribution } from './MapAttribution.jsx'
import GeoapifyMap from './GeoapifyMap.jsx'

export function LocationPicker({ value, onConfirm, onChange }) {
  const [draft, setDraft] = useState(value || {}),
    [query, setQuery] = useState(''),
    [suggestions, setSuggestions] = useState([]),
    [error, setError] = useState(''),
    [searching, setSearching] = useState(false),
    [resolving, setResolving] = useState(false),
    [searched, setSearched] = useState(false)
  const sequence = useRef(0),
    suggestionsList = useRef(null),
    lookup = useRef(null),
    currentDraft = useRef(value || {}),
    id = useId()
  const busy = searching || resolving
  useEffect(() => {
    const next = value || {}
    if (JSON.stringify(next) === JSON.stringify(currentDraft.current)) return
    lookup.current?.abort()
    currentDraft.current = next
    setDraft(next)
    setResolving(false)
  }, [value])
  useEffect(
    () => () => {
      lookup.current?.abort()
    },
    [],
  )
  useEffect(() => {
    const current = ++sequence.current,
      controller = new AbortController()
    setSuggestions([])
    setSearched(false)
    if (query.trim().length < 3) {
      setSearching(false)
      return
    }
    const timer = setTimeout(async () => {
      setSearching(true)
      setError('')
      try {
        const results = await geoapifySearch(
          'autocomplete',
          { text: query.trim(), filter: 'countrycode:lk', limit: 5 },
          controller.signal,
        )
        if (current === sequence.current) {
          setSuggestions(results)
          setSearched(true)
        }
      } catch (failure) {
        if (current === sequence.current && failure.name !== 'AbortError') setError(failure.message)
      } finally {
        if (current === sequence.current) setSearching(false)
      }
    }, 450)
    return () => {
      clearTimeout(timer)
      controller.abort()
      sequence.current++
    }
  }, [query])
  const updateDraft = (next) => {
    currentDraft.current = next
    setDraft(next)
    onChange?.(next)
  }
  const select = (place) => {
    sequence.current++
    lookup.current?.abort()
    updateDraft({ location: geoPoint(place.lat, place.lon), address: place.formatted || '' })
    setSuggestions([])
    setQuery('')
    setError('')
    setSearching(false)
    setResolving(false)
  }
  const reverse = async (location = draft.location, controller = new AbortController()) => {
    if (!position(location)) return
    lookup.current?.abort()
    lookup.current = controller
    updateDraft({ location, address: '' })
    setResolving(true)
    setError('')
    try {
      const chosen = position(location)
      const results = await geoapifySearch(
        'reverse',
        {
          lat: chosen.lat,
          lon: chosen.lng,
          limit: 1,
        },
        controller.signal,
      )
      if (!controller.signal.aborted) {
        if (!results[0]?.formatted)
          throw new Error('No street address was found for this pin. Enter the address manually.')
        updateDraft({ location, address: results[0].formatted })
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message)
    } finally {
      if (lookup.current === controller && !controller.signal.aborted) setResolving(false)
    }
  }
  const pin = (location) => reverse(location)
  const locate = () => {
    if (!navigator.geolocation) {
      setError('This browser does not support location. Search or place a pin.')
      return
    }
    lookup.current?.abort()
    const controller = new AbortController()
    lookup.current = controller
    updateDraft({ location: null, address: '' })
    setResolving(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      (result) => {
        if (controller.signal.aborted) return
        lookup.current = null
        reverse(geoPoint(result.coords.latitude, result.coords.longitude), controller)
      },
      (failure) => {
        if (controller.signal.aborted) return
        setResolving(false)
        setError(
          failure.code === 1
            ? 'Location permission was denied. Allow location access in your browser, or search for an address and place a pin.'
            : failure.code === 3
              ? 'Finding your location timed out. Try again outdoors, or search for your address.'
              : 'Your current position is unavailable. Search for an address or place a pin.',
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }
  return (
    <section className="re-location-picker">
      <label htmlFor={`${id}-search`}>Search an address</label>
      <input
        id={`${id}-search`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setSuggestions([])
          if (event.key === 'ArrowDown' && suggestions.length) {
            event.preventDefault()
            suggestionsList.current?.querySelector('button')?.focus()
          }
        }}
        placeholder="Street, town or landmark"
        autoComplete="off"
        aria-controls={suggestions.length ? `${id}-suggestions` : undefined}
      />
      {busy && <small role="status">Finding location…</small>}
      {suggestions.length > 0 && (
        <ul
          id={`${id}-suggestions`}
          ref={suggestionsList}
          className="re-suggestions"
          aria-label="Address suggestions"
        >
          {suggestions.map((place, index) => (
            <li key={place.place_id || `${place.lat},${place.lon}-${index}`}>
              <button type="button" onClick={() => select(place)}>
                {place.formatted}
              </button>
            </li>
          ))}
        </ul>
      )}
      {searched && !suggestions.length && !error && (
        <small role="status">
          No matching addresses found. Try a nearby landmark or place a pin.
        </small>
      )}
      <div className="re-map-actions">
        <button type="button" onClick={locate} disabled={busy}>
          Use my current location
        </button>
        <button type="button" onClick={() => reverse()} disabled={busy || !draft.location}>
          Look up pin address
        </button>
      </div>
      <GeoapifyMap
        markers={
          draft.location
            ? [{ id: 'pin', location: draft.location, title: 'Selected location', draggable: true }]
            : []
        }
        onPin={pin}
      />
      <small>
        Click the map or drag the pin to find its address. You can correct the address below.
      </small>
      <label htmlFor={`${id}-address`}>Delivery / shop address</label>
      <textarea
        id={`${id}-address`}
        value={draft.address || ''}
        maxLength={600}
        onChange={(event) => {
          lookup.current?.abort()
          setResolving(false)
          setError('')
          updateDraft({ ...draft, address: event.target.value })
        }}
      />
      {draft.location && (
        <small>
          Latitude {draft.location.coordinates[1].toFixed(6)} · Longitude{' '}
          {draft.location.coordinates[0].toFixed(6)}
        </small>
      )}
      {error && (
        <p role="alert" className="re-map-error">
          {error}
        </p>
      )}
      {onConfirm && (
        <button
          type="button"
          className="re-map-primary"
          disabled={!draft.location || (draft.address || '').trim().length < 5 || busy}
          onClick={() => onConfirm(draft)}
        >
          Confirm location
        </button>
      )}
      <MapAttribution />
    </section>
  )
}
