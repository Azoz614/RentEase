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
  user,
}) {
  return (
    <>
      <div className="business-welcome">
        <div>
          <span className="workspace-kicker">SHOP OVERVIEW</span>
          <h2>{user.shopName || user.username}</h2>
          <p>Manage your catalog and respond to customer requests in one place.</p>
        </div>
        <button onClick={() => setSection('add')}>
          <UiIcon name="plus" size={17} /> Add a rental item
        </button>
      </div>
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
          <small>Accepted rental value</small>
          <b>{currency(bookedValue)}</b>
          <em>Rental amount, not collected payments</em>
        </article>
      </div>
      <div className="business-overview-grid">
        <section className="workspace-card">
          <div className="workspace-card-head">
            <div>
              <small className="workspace-kicker">NEEDS ATTENTION</small>
              <h2>Latest booking requests</h2>
            </div>
            <button onClick={() => setSection('bookings')}>View all →</button>
          </div>
          {requests.length ? (
            requests
              .slice(0, 4)
              .map((request) => (
                <BookingRow key={request._id} request={request} decide={decide} busy={busy} />
              ))
          ) : (
            <div className="workspace-empty">New customer bookings will appear here.</div>
          )}
        </section>
        <section className="workspace-card">
          <div className="workspace-card-head">
            <div>
              <small className="workspace-kicker">CATALOG SNAPSHOT</small>
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
      <section className="workspace-roadmap">
        <span>WORKSPACE CAPABILITIES</span>
        <div>
          <b>Available now</b>
          <p>
            Inventory, booking decisions, date conflict protection, and assigned delivery updates.
          </p>
        </div>
        <div>
          <b>Next platform services</b>
          <p>
            Online payment, deposits and refunds, weekly/hourly pricing, invoices, and package
            builder.
          </p>
        </div>
      </section>
    </>
  )
}
