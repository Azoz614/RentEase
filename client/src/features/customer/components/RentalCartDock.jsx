import { useState } from 'react'
import { formatCurrency as money } from '../../../utils/currency.js'

export default function RentalCartDock({ cartProducts, cartShop, days, subtotal, onClear }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <aside className="cart-dock">
      <div className="cart-summary">
        <span className="cart-bubble">{cartProducts.length}</span>
        <div>
          <b>
            {cartProducts.length} {cartProducts.length === 1 ? 'item' : 'items'} in your request
            {cartShop && <span className="cart-shop"> · from {cartShop.name}</span>}
          </b>
          <small>
            {days
              ? `${days} days · ${money(subtotal)} before delivery · one pickup or one rider`
              : 'Choose a valid rental end date'}
          </small>
        </div>
      </div>
      <div className="cart-dock-actions">
        {onClear &&
          (confirming ? (
            <span className="cart-clear-confirm" role="group" aria-label="Confirm clearing your request">
              <span>Remove all?</span>
              <button type="button" className="cart-clear-yes" onClick={onClear}>
                Yes, clear
              </button>
              <button type="button" className="cart-clear" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="cart-clear" onClick={() => setConfirming(true)}>
              Clear
            </button>
          ))}
        <button
          className="cart-link"
          onClick={() => document.getElementById('rental-checkout')?.showModal()}
        >
          Review request →
        </button>
      </div>
    </aside>
  )
}
