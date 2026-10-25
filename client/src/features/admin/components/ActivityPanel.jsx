import { Empty } from './Empty.jsx'

export default function ActivityPanel({ auditEvents }) {
  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <span className="admin-kicker">ADMIN AUDIT TRAIL</span>
          <h2>Recent platform actions</h2>
          <p className="admin-card-subtitle">
            Account, listing, booking, and delivery changes with their actor and time.
          </p>
        </div>
        <span className="admin-count">{auditEvents.length} events</span>
      </div>
      {auditEvents.length ? (
        <div className="admin-audit-list">
          {auditEvents.map((event) => (
            <article key={event._id}>
              <span className="admin-audit-mark">
                {event.actorRole === 'admin'
                  ? 'A'
                  : event.actorRole === 'rental_shop'
                    ? 'S'
                    : event.actorRole === 'delivery_partner'
                      ? 'D'
                      : 'U'}
              </span>
              <div>
                <b>{event.summary}</b>
                <p>
                  {event.actorId?.username || 'Former account'} · {event.actorRole} · {event.action}
                </p>
              </div>
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
            </article>
          ))}
        </div>
      ) : (
        <Empty text="Platform actions will appear here as users work." />
      )}
    </section>
  )
}
