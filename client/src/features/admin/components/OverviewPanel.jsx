import { Stat } from './Stat.jsx'
import { ProductRow } from './ProductRow.jsx'
import { ActivityChart } from './ActivityChart.jsx'
import { Empty } from './Empty.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'

export default function OverviewPanel({ overview, pendingRequests = 0, products, setSection }) {
  const tasks = [
    { id: 'shops', icon: 'store', label: 'Shop applications', count: overview.pendingShops },
    { id: 'requests', icon: 'orders', label: 'Rental requests waiting', count: pendingRequests },
    { id: 'identity', icon: 'shield', label: 'Customer ID checks' },
  ]
  const waiting = tasks.reduce((sum, task) => sum + (task.count || 0), 0)
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
            <h2>Recently added listings</h2>
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
        <section className="admin-card admin-attention-card">
          <h2>Needs your attention</h2>
          <p>{waiting ? `${waiting} item${waiting === 1 ? '' : 's'} waiting for you.` : 'You are all caught up.'}</p>
          <ul>
            {tasks.map((task) => (
              <li key={task.id}>
                <button type="button" onClick={() => setSection(task.id)}>
                  <span className="admin-attention-icon">
                    <UiIcon name={task.icon} size={18} />
                  </span>
                  <span>{task.label}</span>
                  {task.count > 0 && <b>{task.count}</b>}
                  <UiIcon name="arrow" size={16} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="admin-card admin-activity-card">
        <div className="admin-card-heading">
          <h2>New accounts and listings</h2>
          <span className="admin-count">Last 7 days</span>
        </div>
        <ActivityChart activity={overview.activity} />
      </section>
    </>
  )
}
