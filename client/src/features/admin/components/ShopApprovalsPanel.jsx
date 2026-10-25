import { Empty } from './Empty.jsx'

export default function ShopApprovalsPanel({ busy, reviewShop, shops }) {
  return (
    <section className="admin-card">
      <div className="admin-card-heading">
        <div>
          <span className="admin-kicker">VERIFICATION QUEUE</span>
          <h2>Rental shop applications</h2>
          <p className="admin-card-subtitle">
            Approved shop owners can sign in and use the platform.
          </p>
        </div>
        <span className="admin-count">{shops.length} pending</span>
      </div>
      {shops.length ? (
        <div className="admin-shop-list">
          {shops.map((shop) => (
            <article className="admin-shop-row" key={shop._id}>
              <div className="admin-shop-avatar">{shop.shopName?.[0]?.toUpperCase() || 'S'}</div>
              <div className="admin-shop-info">
                <h3>{shop.shopName}</h3>
                <p>
                  {shop.username} · {shop.email} · {shop.phone}
                </p>
                <small>Applied {new Date(shop.createdAt).toLocaleDateString()}</small>
              </div>
              <div className="admin-shop-actions">
                <button
                  type="button"
                  className="admin-secondary"
                  disabled={busy}
                  onClick={() => reviewShop(shop._id, 'rejected')}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className="admin-primary small"
                  disabled={busy}
                  onClick={() => reviewShop(shop._id, 'approved')}
                >
                  Approve
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty text="There are no rental shop applications waiting for review." />
      )}
    </section>
  )
}
