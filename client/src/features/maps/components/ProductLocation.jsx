import { useState } from 'react'
import GeoapifyMap from './GeoapifyMap.jsx'
import { geoPoint } from '../utils/coordinates.js'

export function ProductLocation({ product }) {
  const [open, setOpen] = useState(false)
  const shop = product.providerId?.shopLocation ? product.providerId : product.shop
  const location =
    shop?.shopLocation ||
    (product.coordinates
      ? geoPoint(product.coordinates.latitude, product.coordinates.longitude)
      : null)
  if (!location) return null
  return (
    <details
      className="re-product-location"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>View rental shop on the map</summary>
      {open && (
        <>
          <p>{shop?.shopAddress || product.location}</p>
          <GeoapifyMap
            markers={[
              {
                id: String(shop?._id || 'shop'),
                kind: 'shop',
                title: shop?.shopName || shop?.username || 'Rental shop',
                location,
              },
            ]}
          />
        </>
      )}
    </details>
  )
}
