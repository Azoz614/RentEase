import { useMemo } from 'react'
import { LocationPicker } from './LocationPicker.jsx'
import { addressText } from '../../identity/utils/address.js'

export function CheckoutLocation({ addresses = [], defaultAddress, selection, onChange }) {
  const saved =
    addresses.find((entry) => entry._id === selection?.addressId) ||
    (!selection?.addressId ? defaultAddress || addresses.find((entry) => entry.isDefault) : null)
  const destination = useMemo(
    () =>
      selection?.destination || {
        address: saved ? addressText(saved) : '',
        location: saved?.location,
      },
    [selection?.destination, saved],
  )
  return (
    <section className="re-map-panel checkout-location">
      <h3>Delivery location</h3>
      <label>
        Saved address
        <select
          aria-label="Delivery address"
          value={selection?.destination ? 'temporary' : selection?.addressId || ''}
          onChange={(event) =>
            onChange(
              event.target.value === 'temporary'
                ? { destination }
                : { addressId: event.target.value },
            )
          }
        >
          <option value="">Default saved address</option>
          {addresses.map((entry) => (
            <option key={entry._id} value={entry._id}>
              {entry.line1}, {entry.city}
              {entry.isDefault ? ' (default)' : ''}
            </option>
          ))}
          <option value="temporary">Another delivery location</option>
        </select>
      </label>
      <LocationPicker value={destination} onChange={(next) => onChange({ destination: next })} />
      <p>
        Your address and map pin update this booking only. Delivery is recalculated automatically.
      </p>
    </section>
  )
}
