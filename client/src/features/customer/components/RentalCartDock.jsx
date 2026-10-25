import { formatCurrency as money } from '../../../utils/currency.js'

export default function RentalCartDock({ cartProducts, days, subtotal }) {
  return (
    <aside className="cart-dock">
      <div className="cart-summary">
        <span className="cart-bubble">{cartProducts.length}</span>
        <div>
          <b>
            {cartProducts.length} {cartProducts.length === 1 ? 'item' : 'items'} in your request
          </b>
          <small>
            {days
              ? `${days} days · ${money(subtotal)} before delivery`
              : 'Choose a valid rental end date'}
          </small>
        </div>
      </div>
      <button
        className="cart-link"
        onClick={() => document.getElementById('rental-checkout')?.showModal()}
      >
        Review request →
      </button>
    </aside>
  )
}
