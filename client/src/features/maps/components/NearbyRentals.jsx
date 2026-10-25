import { formatCurrencyFixed as money } from '../../../utils/currency.js'
import { useEffect, useRef, useState } from 'react'
import GeoapifyMap from './GeoapifyMap.jsx'
import { LocationPicker } from './LocationPicker.jsx'

export function NearbyRentals({ api, onView, startDate, endDate }) {
  const [origin, setOrigin] = useState(null),
    [editing, setEditing] = useState(false),
    [radius, setRadius] = useState(10),
    [products, setProducts] = useState([]),
    [searched, setSearched] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState('')
  const sequence = useRef(0)
  const find = async () => {
    const current = ++sequence.current
    setBusy(true)
    setError('')
    setProducts([])
    setSelected('')
    try {
      const query = new URLSearchParams({
        longitude: origin.location.coordinates[0],
        latitude: origin.location.coordinates[1],
        km: radius,
        ...(startDate && endDate ? { startDate, endDate } : {}),
      })
      const result = await api(`/api/locations/nearby?${query}`)
      if (current === sequence.current) {
        setProducts(result.products)
        setSearched(true)
      }
    } catch (failure) {
      if (current === sequence.current) setError(failure.message)
    } finally {
      if (current === sequence.current) setBusy(false)
    }
  }
  useEffect(() => {
    sequence.current++
    setProducts([])
    setSearched(false)
    setSelected('')
    setBusy(false)
    return () => {
      sequence.current++
    }
  }, [origin, radius, startDate, endDate])
  const markers = [
    ...new Map(
      products.map((product) => [
        product.shop._id,
        {
          id: product.shop._id,
          kind: 'shop',
          title: `${product.shop.shopName || product.shop.username}: ${products
            .filter((row) => row.shop._id === product.shop._id)
            .map((row) => row.title)
            .join(', ')}`,
          location: product.shop.shopLocation,
        },
      ]),
    ).values(),
  ]
  return (
    <section className="re-map-panel">
      <h2>Nearby rentals</h2>
      <p>
        Find available items near your chosen location. Distances here are approximate geographic
        proximity, not driving distance.
      </p>
      <div className="re-map-actions">
        <button type="button" onClick={() => setEditing(!editing)}>
          {origin ? 'Change search location' : 'Choose search location'}
        </button>
        <select
          aria-label="Nearby radius"
          value={radius}
          onChange={(event) => setRadius(Number(event.target.value))}
        >
          {[5, 10, 25, 50, 100].map((km) => (
            <option key={km} value={km}>
              Within {km} km
            </option>
          ))}
        </select>
        <button type="button" disabled={!origin || busy} onClick={find}>
          {busy ? 'Searching…' : 'Find nearest rentals'}
        </button>
      </div>
      {editing && (
        <LocationPicker
          value={origin}
          onConfirm={(value) => {
            setOrigin(value)
            setEditing(false)
          }}
        />
      )}
      {error && (
        <p role="alert" className="re-map-error">
          {error}
        </p>
      )}
      {searched && (
        <>
          <GeoapifyMap
            markers={[
              ...markers,
              { id: 'origin', title: 'Search location', location: origin.location },
            ]}
            selected={selected}
            onSelect={setSelected}
          />
          <small>Sorted nearest first · up to 100 nearby shops</small>
          <div className="re-map-grid">
            {products
              .filter(
                (product) => !selected || selected === 'origin' || selected === product.shop._id,
              )
              .map((product) => (
                <article className="re-map-task" key={product._id}>
                  <img src={product.photos?.[0]} alt="" />
                  <h3>{product.title}</h3>
                  <p>
                    {product.shop.shopName || product.shop.username} ·{' '}
                    {(product.shop.distanceMeters / 1000).toFixed(1)} km away
                  </p>
                  <b>{money(product.dailyRate)} / day</b>
                  <div className="re-map-actions">
                    <button type="button" onClick={() => onView(product)}>
                      View product
                    </button>
                    <button type="button" onClick={() => setSelected(product.shop._id)}>
                      View shop location
                    </button>
                  </div>
                </article>
              ))}
          </div>
          {selected && (
            <button type="button" onClick={() => setSelected('')}>
              Show all nearby shops
            </button>
          )}
          {!products.length && (
            <p>No available rentals within this radius. Try a larger distance.</p>
          )}
        </>
      )}
    </section>
  )
}
