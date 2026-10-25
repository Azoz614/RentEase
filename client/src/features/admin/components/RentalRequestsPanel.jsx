import { Empty } from './Empty.jsx'

export default function RentalRequestsPanel({
  api,
  busy,
  rentalRequests,
  requestsLoading,
  runAction,
  setDeclineTarget,
}) {
  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <span className="admin-kicker">PROVIDER WORKFLOW</span>
          <h2>Customer rental requests</h2>
          <p className="admin-card-subtitle">
            All customer requests, across admin inventory and rental shops. New requests refresh
            automatically.
          </p>
        </div>
        <span className="admin-count">{rentalRequests.length} requests</span>
      </div>
      {rentalRequests.length ? (
        <div className="admin-product-list">
          {rentalRequests.map((request) => (
            <article className="admin-shop-row" key={request._id}>
              <div className="admin-shop-info">
                <h3>{request.items.map((item) => item.title).join(', ')}</h3>
                <p>
                  {request.customerId?.username} · {request.customerId?.email} · Identity:{' '}
                  {request.customerId?.identityStatus || 'legacy / review required'} ·{' '}
                  {new Date(request.startDate).toLocaleDateString()} –{' '}
                  {new Date(request.endDate).toLocaleDateString()}
                </p>
                <small>
                  {request.deliveryMethod === 'partner'
                    ? `Partner delivery · ${Number(request.distanceKm || 0).toFixed(1)} km · ${request.etaMinutes} min estimate`
                    : 'Customer pickup'}{' '}
                  · {Number(request.total).toLocaleString()} LKR
                </small>
                <div className="admin-shop-actions">
                  {request.items
                    .filter(
                      (item) =>
                        item.decision === 'pending' &&
                        ['pending', 'confirmed'].includes(request.status),
                    )
                    .map((item) => (
                      <span key={item.productId}>
                        <b>{item.title}</b>{' '}
                        <button
                          className="admin-secondary"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setDeclineTarget({
                              requestId: request._id,
                              productId: item.productId,
                              title: item.title,
                            })
                          }
                        >
                          Decline
                        </button>{' '}
                        <button
                          className="admin-primary small"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            runAction(
                              () =>
                                api(
                                  `/api/provider/requests/${request._id}/items/${item.productId}`,
                                  {
                                    method: 'PATCH',
                                    body: JSON.stringify({ decision: 'accepted' }),
                                  },
                                ),
                              'Request accepted.',
                            )
                          }
                        >
                          Accept
                        </button>
                      </span>
                    ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : requestsLoading ? (
        <p role="status">Loading customer requests…</p>
      ) : (
        <Empty text="There are no customer rental requests yet." />
      )}
    </section>
  )
}
