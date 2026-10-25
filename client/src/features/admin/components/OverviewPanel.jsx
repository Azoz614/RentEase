import { Stat } from './Stat.jsx'
import { ProductRow } from './ProductRow.jsx'
import { ActivityChart } from './ActivityChart.jsx'
import { Empty } from './Empty.jsx'

export default function OverviewPanel({ overview, products, setSection }) {
  return (
    <>
      <div className="admin-stat-grid">
        <Stat
          label="All accounts"
          value={overview.users}
          detail={`${overview.activeUsers} active`}
          mark="U"
        />
        <Stat
          label="Active listings"
          value={overview.products}
          detail="Available to rent"
          mark="P"
        />
        <Stat
          label="Shop reviews"
          value={overview.pendingShops}
          detail="Awaiting your review"
          mark="S"
        />
      </div>
      <div className="admin-overview-grid">
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <span className="admin-kicker">LATEST WORK</span>
              <h2>Recently added products</h2>
            </div>
            <button
              type="button"
              className="admin-text-button"
              onClick={() => setSection('products')}
            >
              View all →
            </button>
          </div>
          {products.filter((product) => product.active).length ? (
            <div className="admin-product-list">
              {products
                .filter((product) => product.active)
                .slice(0, 4)
                .map((product) => (
                  <ProductRow key={product._id} product={product} />
                ))}
            </div>
          ) : (
            <Empty text="No active listings yet. Add your first rental listing." />
          )}
        </section>
        <section className="admin-card admin-approval-card">
          <div className="admin-kicker">SHOP ONBOARDING</div>
          <h2>
            {overview.pendingShops
              ? `${overview.pendingShops} shop${overview.pendingShops === 1 ? '' : 's'} need review`
              : 'No applications waiting'}
          </h2>
          <p>Review shop owner details before granting access to the rental tools.</p>
          <button className="admin-primary small" type="button" onClick={() => setSection('shops')}>
            Review applications <span>→</span>
          </button>
        </section>
      </div>
      <section className="admin-card admin-activity-card">
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">LAST 7 DAYS</span>
            <h2>New accounts and listings</h2>
          </div>
          <span className="admin-count">Daily activity</span>
        </div>
        <ActivityChart activity={overview.activity} />
      </section>
    </>
  )
}
