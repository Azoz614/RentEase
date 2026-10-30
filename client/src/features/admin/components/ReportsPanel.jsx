import { roleLabels } from '../utils/adminPresentation.js'
import { Stat } from './Stat.jsx'
import { Empty } from './Empty.jsx'
import CommissionPanel from '../../payments/components/CommissionPanel.jsx'

export default function ReportsPanel({ exportCsv, overview, products, revenue, users, api }) {
  return (
    <>
      {api && <CommissionPanel api={api} role="admin" />}
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
          label="Booking charges recorded"
          value={`LKR ${Number(revenue.rentalCollected || 0).toLocaleString('en-LK')}`}
          detail={`${revenue.paidBookings || 0} paid of ${revenue.bookings || 0} bookings`}
          mark="LKR"
        />
        <Stat
          label="Deposits outstanding"
          value={`LKR ${Math.max(0, Number(revenue.depositsHeld || 0) - Number(revenue.depositsRefunded || 0) - Number(revenue.adjustmentsRetained || 0)).toLocaleString('en-LK')}`}
          detail={`LKR ${Number(revenue.depositsHeld || 0).toLocaleString('en-LK')} held · ${Number(revenue.depositsRefunded || 0).toLocaleString('en-LK')} released`}
          mark="D"
        />
        <Stat
          label="Fees kept from deposits"
          value={`LKR ${Number(revenue.adjustmentsRetained || 0).toLocaleString('en-LK')}`}
          detail="Late, damage and return collection fees"
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
