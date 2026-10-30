import { formatCurrency as money } from '../../../utils/currency.js'
import { useEffect, useId, useRef, useState } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { RentalPhoto } from '../../products/components/RentalPhoto.jsx'
import GeoapifyMap from './GeoapifyMap.jsx'
import { LocationPicker } from './LocationPicker.jsx'
import { rentalMapMarkers } from '../utils/rentalMapMarkers.js'
import { geoPoint, position } from '../utils/coordinates.js'

const radii = [5, 10, 25, 50, 100]
const distance = (product) => Number.isFinite(product.shop?.distanceMeters) ? product.shop.distanceMeters : Infinity

function NearbyEmpty({ filtered, nextRadius, onClear, onExpand, onChange }) {
  return <div className="re-nearby-empty">
    <UiIcon name="search" size={28} />
    <h3>{filtered ? 'No items match this category' : 'No available items in this area'}</h3>
    <p>{filtered ? 'Try another category to see more nearby rentals.' : 'Try a wider search area or change your rental dates.'}</p>
    <div className="re-map-actions">
      {filtered && <button type="button" onClick={onClear}>Show all categories</button>}
      {nextRadius && <button className="re-map-primary" type="button" onClick={onExpand}>Search within {nextRadius} km</button>}
      <button type="button" onClick={onChange}>Change area</button>
    </div>
  </div>
}

export function NearbyRentals({ api, onView, startDate, endDate }) {
  const [origin, setOrigin] = useState(null)
  const [editing, setEditing] = useState(false)
  const [radius, setRadius] = useState(10)
  const [result, setResult] = useState(null)
  const [retry, setRetry] = useState(0)
  const [locationError, setLocationError] = useState('')
  const [locating, setLocating] = useState(false)
  const [selection, setSelection] = useState(null)
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState('nearest')
  const [mobileView, setMobileView] = useState('list')
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia?.('(max-width: 850px)').matches ?? false)
  const locationRequest = useRef(0)
  const explorer = useRef(null)
  const pickerId = useId()

  useEffect(() => {
    const breakpoint = window.matchMedia?.('(max-width: 850px)')
    if (!breakpoint) return
    const update = (event) => setSmallScreen(event.matches)
    breakpoint.addEventListener('change', update)
    return () => breakpoint.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const request = locationRequest
    return () => { request.current++ }
  }, [])

  const query = position(origin?.location) ? new URLSearchParams({
    longitude: origin.location.coordinates[0], latitude: origin.location.coordinates[1], km: radius,
    ...(startDate && endDate ? { startDate, endDate } : {}),
  }).toString() : ''
  const requestKey = `${query}|${retry}`
  useEffect(() => {
    if (!query) return
    const controller = new AbortController()
    let current = true
    api(`/api/locations/nearby?${query}`, { signal: controller.signal })
      .then((response) => {
        if (current) setResult({ key: requestKey, query, products: Array.isArray(response.products) ? response.products : [] })
      })
      .catch((failure) => {
        if (current) setResult((previous) => ({
          key: requestKey, query,
          products: previous?.query === query ? previous.products : [],
          error: failure.message || 'We could not load nearby rentals. Please try again.',
        }))
      })
    return () => { current = false; controller.abort() }
  }, [api, query, requestKey])

  const busy = Boolean(query) && result?.key !== requestKey
  const error = !busy && result?.query === query ? result.error : ''
  const products = result?.query === query ? result.products : []
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort()
  const visible = products.filter((product) => category === 'all' || product.category === category).sort((a, b) => {
    if (sort === 'price') return Number(a.dailyRate || 0) - Number(b.dailyRate || 0) || distance(a) - distance(b)
    if (sort === 'rating') return Number(b.ratingAverage || 0) - Number(a.ratingAverage || 0) || distance(a) - distance(b)
    return distance(a) - distance(b)
  })
  const markers = rentalMapMarkers(visible)
  const selected = selection?.query === query ? selection.id : ''
  const selectMarker = (id) => setSelection({ query, id })
  const nextRadius = radii.find((value) => value > radius)

  const chooseArea = () => {
    locationRequest.current++
    setLocating(false)
    setLocationError('')
    setEditing(true)
  }
  const locate = () => {
    if (!navigator.geolocation || window.isSecureContext === false) {
      setLocationError('Your current location is unavailable. Search for a town or area instead.')
      setEditing(true)
      return
    }
    const current = ++locationRequest.current
    setLocating(true)
    setLocationError('')
    try {
      navigator.geolocation.getCurrentPosition((response) => {
        if (current !== locationRequest.current) return
        const location = geoPoint(response.coords.latitude, response.coords.longitude)
        setLocating(false)
        if (!position(location)) {
          setLocationError('We could not find a valid location. Choose an area instead.')
          setEditing(true)
          return
        }
        setOrigin({ location, address: 'Your current location' })
        setCategory('all')
        setEditing(false)
      }, (failure) => {
        if (current !== locationRequest.current) return
        setLocating(false)
        setLocationError(failure.code === 1
          ? 'Location access is off. Search for a town or area below instead.'
          : 'We could not get your location. Search for an area below, or try again.')
        setEditing(true)
      }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 })
    } catch {
      setLocating(false)
      setLocationError('Your location is unavailable. Search for an area below instead.')
      setEditing(true)
    }
  }
  const viewProduct = (id) => {
    const product = products.find((entry) => entry._id === id)
    if (!product) return
    selectMarker(markers.find((marker) => marker.products.some((entry) => entry.id === id))?.id || '')
    onView({ ...product, providerId: product.shop || product.providerId, location: product.shop?.shopAddress || product.location })
  }
  const showOnMap = (marker) => {
    selectMarker(marker.id)
    setMobileView('map')
    if (smallScreen) explorer.current?.scrollIntoView?.({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })
  }

  return (
    <section className="re-map-panel re-nearby-panel" aria-label="Nearby rental map search">
      <div className="re-nearby-heading">
        <div><span className="market-kicker">A LITTLE CLOSER. A LOT EASIER.</span><h2>Find rentals near you</h2><p>Choose your area, compare nearby items, and open the one you like.</p></div>
        <span className="re-nearby-map-icon"><UiIcon name="map" size={27} /></span>
      </div>

      <div className={`re-nearby-location${origin ? ' has-location' : ''}`}>
        {origin ? <div className="re-nearby-chosen"><UiIcon name="pin" size={20} /><div><small>Looking around</small><strong>{origin.address}</strong></div></div>
          : <div className="re-nearby-location-copy"><strong>Where would you like to rent?</strong><span>Use your location or search for a town, street or landmark.</span></div>}
        <div className="re-map-actions">
          <button className={origin ? '' : 're-map-primary'} type="button" onClick={locate} disabled={locating}><UiIcon name="pin" size={17} />{locating ? 'Finding your location…' : 'Use my location'}</button>
          <button type="button" onClick={chooseArea} aria-expanded={editing} aria-controls={pickerId}><UiIcon name="search" size={17} />{origin ? 'Change area' : 'Choose an area'}</button>
        </div>
      </div>
      {locationError && <p role="alert" className="re-map-error">{locationError}</p>}
      {editing && <div className="re-nearby-picker" id={pickerId}>
        <div className="re-nearby-picker-heading"><h3>Choose your search area</h3><button type="button" onClick={() => setEditing(false)} aria-label="Close area search"><UiIcon name="close" size={18} /></button></div>
        <LocationPicker compact value={origin} confirmLabel="Show rentals here" onConfirm={(value) => {
          locationRequest.current++
          setOrigin(value); setCategory('all'); setEditing(false); setLocationError(''); setLocating(false)
        }} />
      </div>}

      {!origin && !editing && <div className="re-nearby-welcome">
        <div className="re-nearby-welcome-icons" aria-hidden="true"><UiIcon name="store" size={26} /><UiIcon name="box" size={32} /><UiIcon name="truck" size={26} /></div>
        <h3>Good gear might be just around the corner.</h3><p>Choose a location to see available rentals and pickup prices nearby.</p>
      </div>}

      {origin && <>
        <div className="re-nearby-filters">
          <label>Search distance<select aria-label="Nearby radius" value={radius} onChange={(event) => { setRadius(Number(event.target.value)); setSelection(null) }}>{radii.map((km) => <option key={km} value={km}>Within {km} km</option>)}</select></label>
          <label>Item type<select value={category} onChange={(event) => { setCategory(event.target.value); setSelection(null) }}><option value="all">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="nearest">Nearest first</option><option value="price">Lowest daily price</option><option value="rating">Highest rated</option></select></label>
          <button type="button" className="re-nearby-refresh" disabled={busy} onClick={() => setRetry((value) => value + 1)} aria-label="Refresh nearby rentals" title="Refresh rentals"><UiIcon name="refresh" size={18} /></button>
        </div>
        {error && <div role="alert" className="re-map-error re-nearby-search-error"><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>}
        <div className="re-nearby-result-heading">
          <div aria-live="polite"><strong>{busy ? (products.length ? 'Updating rentals…' : 'Finding rentals near you…') : `${visible.length} ${visible.length === 1 ? 'rental' : 'rentals'} found`}</strong><span>{!busy && visible.length > 0 ? `Within ${radius} km · Prices per day` : 'Available for your selected dates'}</span></div>
          <div className="re-nearby-view-switch" role="group" aria-label="Rental results view"><button type="button" aria-pressed={mobileView === 'list'} onClick={() => setMobileView('list')}><UiIcon name="orders" size={16} />List</button><button type="button" aria-pressed={mobileView === 'map'} onClick={() => setMobileView('map')}><UiIcon name="map" size={16} />Map</button></div>
        </div>
        {busy && !products.length ? <div className="re-nearby-loading" role="status"><span className="register-spinner" />Looking for available items in this area…</div>
          : !visible.length && !error ? <NearbyEmpty filtered={category !== 'all'} nextRadius={nextRadius} onClear={() => setCategory('all')} onExpand={() => setRadius(nextRadius)} onChange={chooseArea} />
          : products.length > 0 && <div ref={explorer} className="re-nearby-explorer" data-view={mobileView}>
          {(!smallScreen || mobileView === 'map') && <div className="re-nearby-map">
            <GeoapifyMap markers={[...markers, { id: 'origin', title: 'Your search location', kind: 'destination', location: origin.location }]} selected={selected} onSelect={selectMarker} onProductView={viewProduct} label="Nearby rental products. Select a price pin to view a product or choose from items at that location." />
            <div className="re-nearby-legend"><span><i className="re-nearby-legend-origin" /> Your search area</span><span>Tap a price to see the item</span>{selected && <button type="button" onClick={() => selectMarker('')}>Show all locations</button>}</div>
          </div>}
          <div className="re-nearby-results" hidden={smallScreen && mobileView === 'map'} role="region" aria-label="Nearby rental products" tabIndex={0} aria-busy={busy}>
            {visible.map((product) => {
              const marker = markers.find((entry) => entry.products.some((item) => item.id === product._id))
              const meters = distance(product)
              return <article className={`re-nearby-card${marker && selected === marker.id ? ' is-selected' : ''}`} key={product._id}>
                <button className="re-nearby-photo" type="button" onClick={() => viewProduct(product._id)} aria-label={`View photos and details for ${product.title}`}><RentalPhoto src={product.photos?.[0]} alt={product.title} /></button>
                <div className="re-nearby-card-copy">
                  <span className="re-nearby-category">{product.category}</span>
                  <h3><button type="button" onClick={() => viewProduct(product._id)}>{product.title}</button></h3>
                  <p className="re-nearby-shop">{product.shop?.shopName || product.shop?.username || 'Rental shop'}</p>
                  {Number.isFinite(meters) && <span className="re-nearby-distance"><UiIcon name="pin" size={12} />{meters < 1000 ? `${Math.round(meters)} m away` : `${(meters / 1000).toFixed(1)} km away`}</span>}
                  {product.ratingCount > 0 && <span className="re-nearby-rating">★ {Number(product.ratingAverage).toFixed(1)} <small>({product.ratingCount} reviews)</small></span>}
                  <b>{money(product.dailyRate)}<small> / day</small></b>
                </div>
                <div className="re-nearby-card-actions"><button type="button" onClick={() => viewProduct(product._id)}>View product <UiIcon name="arrow" size={15} /></button>{marker && <button type="button" onClick={() => showOnMap(marker)} aria-label={`Show ${product.title} on map`} aria-pressed={selected === marker.id}><UiIcon name="pin" size={15} />Show on map</button>}</div>
              </article>
            })}
          </div>
        </div>}
        <small className="re-nearby-distance-note">Distances are approximate, not driving distances. Pins show shop pickup locations; a number means several items are available there.</small>
      </>}
    </section>
  )
}
