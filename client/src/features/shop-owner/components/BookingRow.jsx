import { formatCurrency as currency } from '../../../utils/currency.js'

export default function BookingRow({ request, decide, busy, expanded = false }) {
  return (
    <article className={`owner-booking-row${expanded ? ' expanded' : ''}`}>
      <div className="owner-booking-main">
        <div className="owner-booking-date">
          <b>{new Date(request.startDate).toLocaleDateString()}</b>
          <span>to</span>
          <b>{new Date(request.endDate).toLocaleDateString()}</b>
        </div>
        <div className="owner-booking-copy">
          <h3>{request.items.map((item) => item.title).join(', ')}</h3>
          <p>
            {request.customerId?.username || 'Customer'} · requested{' '}
            {new Date(request.createdAt).toLocaleDateString()}
          </p>
        </div>
        <span
          className={`booking-status ${request.items.every((item) => item.decision !== 'pending') ? 'resolved' : ''}`}
        >
          {request.items.some((item) => item.decision === 'pending') ? 'Needs review' : 'Reviewed'}
        </span>
      </div>
      {request.items.map((item) => (
        <div className="owner-booking-item" key={item.productId}>
          <span>
            <b>{item.title}</b>
            <small>
              {item.decision} ·{' '}
              {request.deliveryMethod === 'partner'
                ? `Partner delivery · ${request.distanceKm?.toFixed(1) || 0} km`
                : 'Customer pickup'}{' '}
              · {currency(item.dailyRate)}/day
            </small>
          </span>
          {item.decision === 'pending' && ['pending', 'confirmed'].includes(request.status) ? (
            <div>
              <button
                className="owner-decline"
                disabled={busy}
                onClick={() => decide(request._id, item.productId, 'rejected')}
              >
                Decline
              </button>
              <button
                className="owner-accept"
                disabled={busy}
                onClick={() => decide(request._id, item.productId, 'accepted')}
              >
                Accept
              </button>
            </div>
          ) : (
            <em className={item.decision}>{item.decision}</em>
          )}
        </div>
      ))}
    </article>
  )
}
