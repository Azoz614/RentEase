import { roleLabels } from '../utils/adminPresentation.js'
import { Stat } from './Stat.jsx'
import { Empty } from './Empty.jsx'

export default function ReportsPanel({ exportCsv, overview, products, revenue, users }) {
  return (
    <>
      <div className="admin-report-actions">
        <button
          type="button"
          className="admin-secondary"
          onClick={() =>
            exportCsv('rentease-users.csv', [
              ['Name', 'Email', 'Phone', 'Role', 'Status'],
              ...users.map((item) => [
                item.username,
                item.email,
                item.phone,
                roleLabels[item.role] || item.role,
                item.active ? 'Active' : 'Suspended',
              ]),
            ])
          }
        >
          Download user report
        </button>
        <button
          type="button"
          className="admin-secondary"
          onClick={() =>
            exportCsv('rentease-products.csv', [
              ['Product', 'Category', 'Daily rate LKR', 'Location', 'Status'],
              ...products.map((item) => [
                item.title,
                item.category,
                item.dailyRate,
                item.location,
                item.active ? 'Active' : 'Inactive',
              ]),
            ])
          }
        >
          Download listing report
        </button>
      </div>
      <div className="admin-stat-grid">
        <Stat
          label="Rental revenue"
          value={`LKR ${Number(revenue.rentalCollected || 0).toLocaleString('en-LK')}`}
          detail={`${revenue.bookings || 0} bookings`}
          mark="LKR"
        />
        <Stat
          label="Deposits held"
          value={`LKR ${Number(revenue.depositsHeld || 0).toLocaleString('en-LK')}`}
          detail={`LKR ${Number(revenue.depositsRefunded || 0).toLocaleString('en-LK')} released`}
          mark="D"
        />
        <Stat
          label="Retained adjustments"
          value={`LKR ${Number(revenue.adjustmentsRetained || 0).toLocaleString('en-LK')}`}
          detail="Late and damage fees"
          mark="+"
        />
      </div>
      <div className="admin-overview-grid">
        <section className="admin-card">
          <div className="admin-kicker">ACCOUNT MIX</div>
          <h2>Users by account type</h2>
          {overview.roles.length ? (
            <div className="admin-report-list">
              {overview.roles.map((item) => (
                <div key={item._id}>
                  <span>{roleLabels[item._id] || item._id}</span>
                  <b>{item.count}</b>
                  <i
                    style={{
                      '--bar-width': `${overview.users ? Math.max(4, (item.count / overview.users) * 100) : 0}%`,
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Account data will show here." />
          )}
        </section>
        <section className="admin-card">
          <div className="admin-kicker">RENTAL CATALOG</div>
          <h2>Listings by category</h2>
          {overview.categories.length ? (
            <div className="admin-report-list">
              {overview.categories.map((item) => (
                <div key={item._id}>
                  <span>{item._id}</span>
                  <b>{item.count}</b>
                  <i
                    style={{
                      '--bar-width': `${overview.products ? Math.max(4, (item.count / overview.products) * 100) : 0}%`,
                    }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Publish products to see category reports." />
          )}
        </section>
      </div>
    </>
  )
}
