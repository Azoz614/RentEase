export function ActivityChart({ activity = {} }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (6 - index))
    const key = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
    return {
      key,
      label: date.toLocaleDateString('en', { weekday: 'short', timeZone: 'Asia/Colombo' }),
    }
  })
  const users = Object.fromEntries((activity.users || []).map((item) => [item._id, item.count]))
  const products = Object.fromEntries(
    (activity.products || []).map((item) => [item._id, item.count]),
  )
  const max = Math.max(1, ...days.flatMap(({ key }) => [users[key] || 0, products[key] || 0]))
  return (
    <div className="admin-activity-chart">
      <div className="admin-chart-legend">
        <span>
          <i className="users" />
          New accounts
        </span>
        <span>
          <i className="products" />
          New listings
        </span>
      </div>
      <div className="admin-chart-bars">
        {days.map(({ key, label }) => (
          <div className="admin-chart-day" key={key}>
            <div className="admin-chart-pair">
              <i
                className="users"
                style={{ height: `${Math.max(3, ((users[key] || 0) / max) * 100)}%` }}
                title={`${users[key] || 0} accounts`}
              />
              <i
                className="products"
                style={{ height: `${Math.max(3, ((products[key] || 0) / max) * 100)}%` }}
                title={`${products[key] || 0} listings`}
              />
            </div>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
