import BookingRow from './BookingRow.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { formatCurrency as currency } from '../../../utils/currency.js'

export default function ShopOverview({
  accepted,
  bookedValue,
  busy,
  decide,
  pending,
  products,
  requests,
  setSection,
}) {
  // Only bookings with an item still waiting for this shop's decision need attention.
  const toReview = requests.filter((request) =>
    ['pending', 'confirmed'].includes(request.status) && request.items.some((item) => item.decision === 'pending'))
  return (
    <>
      <div className="business-stat-grid">
        <article>
          <span className="business-stat-icon blue">
            <UiIcon name="box" />
          </span>
          <small>Active listings</small>
          <b>{products.filter((item) => item.active).length}</b>
          <em>{products.length} total in inventory</em>
        </article>
        <article>
          <span className="business-stat-icon amber">
            <UiIcon name="clock" />
          </span>
          <small>Requests to review</small>
          <b>{pending}</b>
          <em>Awaiting your decision</em>
        </article>
        <article>
          <span className="business-stat-icon green">
            <UiIcon name="check" />
          </span>
          <small>Accepted items</small>
          <b>{accepted.length}</b>
          <em>Across {requests.length} booking requests</em>
        </article>
        <article>
          <span className="business-stat-icon violet">
            <UiIcon name="wallet" />
          </span>
          <small>Paid booking value</small>
          <b>{currency(bookedValue)}</b>
          <em>Your items on paid bookings, before commission</em>
        </article>
      </div>
      <div className="business-overview-grid">
        <section className="workspace-card">
          <div className="workspace-card-head">
            <div>
              <h2>Requests to review</h2>
            </div>
            <button onClick={() => setSection('bookings')}>View all →</button>
          </div>
          {toReview.length ? (
            toReview
              .slice(0, 4)
              .map((request) => (
                <BookingRow key={request._id} request={request} decide={decide} busy={busy} />
              ))
          ) : (
            <div className="workspace-empty">You’re all caught up. New requests will appear here.</div>
          )}
        </section>
        <section className="workspace-card">
          <div className="workspace-card-head">
            <div>
              <h2>Recently listed</h2>
            </div>
            <button onClick={() => setSection('inventory')}>Inventory →</button>
          </div>
          {products.slice(0, 5).map((product) => (
            <div className="owner-product-mini" key={product._id}>
              <img src={product.photos?.[0] || ''} alt="" />
              <div>
                <b>{product.title}</b>
                <small>
                  {product.category} · {currency(product.dailyRate)}/day
                </small>
              </div>
              <span className={product.active ? 'live-pill' : 'paused-pill'}>
                {product.active ? 'Live' : 'Paused'}
              </span>
            </div>
          ))}
          {!products.length && (
            <div className="workspace-empty">Start by adding your first rental listing.</div>
          )}
        </section>
      </div>
    </>
  )
}
