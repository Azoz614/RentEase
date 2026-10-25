import { Empty } from './Empty.jsx'

export default function PromotionsPanel({ api, busy, coupons, runAction, submitCoupon }) {
  return (
    <div className="admin-work-grid">
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">PROMOTION SETUP</span>
            <h2>Create a coupon</h2>
          </div>
        </div>
        <form className="admin-form" onSubmit={submitCoupon}>
          <label>
            Coupon code
            <input name="code" required maxLength="32" placeholder="WELCOME10" />
          </label>
          <div className="admin-form-row">
            <label>
              Discount type
              <select name="kind" defaultValue="percent">
                <option value="percent">Percentage</option>
                <option value="fixed">Fixed LKR amount</option>
              </select>
            </label>
            <label>
              Discount value
              <input name="value" type="number" min="1" step="1" required placeholder="10" />
            </label>
          </div>
          <label>
            Minimum rental subtotal (LKR)
            <input name="minimumSubtotal" type="number" min="0" step="1" defaultValue="0" />
          </label>
          <div className="admin-form-row">
            <label>
              Maximum discount (optional)
              <input name="maximumDiscount" type="number" min="0" step="1" placeholder="No cap" />
            </label>
            <label>
              Redemption limit (optional)
              <input name="maxRedemptions" type="number" min="1" step="1" placeholder="Unlimited" />
            </label>
          </div>
          <label>
            Expiry date (optional)
            <input name="expiresAt" type="date" />
          </label>
          <button className="admin-primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create coupon'}
          </button>
        </form>
      </section>
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">ACTIVE PROMOTIONS</span>
            <h2>Coupon codes</h2>
          </div>
          <span className="admin-count">{coupons.length} total</span>
        </div>
        {coupons.length ? (
          <div className="admin-product-list">
            {coupons.map((coupon) => (
              <article className="admin-coupon-row" key={coupon._id}>
                <div>
                  <b>{coupon.code}</b>
                  <small>
                    {coupon.kind === 'percent'
                      ? `${coupon.value}% off`
                      : `LKR ${Number(coupon.value).toLocaleString()} off`}{' '}
                    · min. LKR {Number(coupon.minimumSubtotal || 0).toLocaleString()}
                  </small>
                  <small>
                    {coupon.redemptionCount} used
                    {coupon.maxRedemptions ? ` of ${coupon.maxRedemptions}` : ''}
                    {coupon.expiresAt
                      ? ` · expires ${new Date(coupon.expiresAt).toLocaleDateString()}`
                      : ''}
                  </small>
                </div>
                <span className={`admin-status ${coupon.active ? 'is-active' : 'is-paused'}`}>
                  {coupon.active ? 'Active' : 'Paused'}
                </span>
                <button
                  className="admin-row-action"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      () =>
                        api(`/api/admin/coupons/${coupon._id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ active: !coupon.active }),
                        }),
                      coupon.active ? 'Coupon paused.' : 'Coupon activated.',
                    )
                  }
                >
                  {coupon.active ? 'Pause' : 'Activate'}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty text="Create a coupon to launch a promotion." />
        )}
      </section>
    </div>
  )
}
