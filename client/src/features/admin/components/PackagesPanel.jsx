import { Empty } from './Empty.jsx'

export default function PackagesPanel({ api, busy, packages, products, runAction, submitPackage }) {
  return (
    <div className="admin-work-grid">
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">PACKAGE BUILDER</span>
            <h2>Create a rental package</h2>
            <p className="admin-card-subtitle">
              Select the required items, then choose optional add-ons.
            </p>
          </div>
        </div>
        <form className="admin-form" onSubmit={submitPackage}>
          <label>
            Package name
            <input name="name" maxLength="120" placeholder="Trip Package" required />
          </label>
          <label>
            Package category
            <input name="category" maxLength="80" placeholder="Travel and adventure" required />
          </label>
          <label>
            Description
            <textarea
              name="description"
              rows="4"
              maxLength="2000"
              placeholder="Describe what is included in this package."
              required
            />
          </label>
          <div className="admin-form-row">
            <label>
              Daily package price (LKR)
              <input name="dailyRate" type="number" min="0" step="1" required />
            </label>
            <label>
              Weekly package price (LKR)
              <input name="weeklyRate" type="number" min="0" step="1" placeholder="Optional" />
            </label>
          </div>
          <div className="admin-form-row">
            <label>
              Available from
              <input name="startsAt" type="date" />
            </label>
            <label>
              Available until
              <input name="endsAt" type="date" />
            </label>
          </div>
          <fieldset className="admin-package-items">
            <legend>Required package items</legend>
            {products
              .filter((item) => item.active)
              .map((item) => (
                <label key={item._id}>
                  <input type="checkbox" name="productIds" value={item._id} />
                  {item.title}
                  <small>LKR {Number(item.dailyRate).toLocaleString()} / day</small>
                </label>
              ))}
          </fieldset>
          <fieldset className="admin-package-items">
            <legend>Optional add-ons</legend>
            {products
              .filter((item) => item.active)
              .map((item) => (
                <label key={item._id}>
                  <input type="checkbox" name="optionalAddOnIds" value={item._id} />
                  {item.title}
                  <small>LKR {Number(item.dailyRate).toLocaleString()} / day</small>
                </label>
              ))}
          </fieldset>
          <button className="admin-primary" type="submit" disabled={busy}>
            {busy ? 'Creating...' : 'Create package'}
          </button>
        </form>
      </section>
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">EXISTING PACKAGES</span>
            <h2>
              {packages.length} package{packages.length === 1 ? '' : 's'}
            </h2>
          </div>
        </div>
        {packages.length ? (
          <div className="admin-package-list">
            {packages.map((rentalPackage) => (
              <article key={rentalPackage._id}>
                <div>
                  <b>{rentalPackage.name}</b>
                  <small>
                    {rentalPackage.category} · {rentalPackage.productIds?.length || 0} required item
                    {rentalPackage.productIds?.length === 1 ? '' : 's'}
                    {rentalPackage.optionalAddOnIds?.length
                      ? ` · ${rentalPackage.optionalAddOnIds.length} add-on${rentalPackage.optionalAddOnIds.length === 1 ? '' : 's'}`
                      : ''}
                  </small>
                  <small>
                    LKR {Number(rentalPackage.dailyRate).toLocaleString()} / day
                    {rentalPackage.weeklyRate
                      ? ` · LKR ${Number(rentalPackage.weeklyRate).toLocaleString()} / week`
                      : ''}
                  </small>
                  {(rentalPackage.startsAt || rentalPackage.endsAt) && (
                    <small>
                      {rentalPackage.startsAt
                        ? new Date(rentalPackage.startsAt).toLocaleDateString()
                        : 'Now'}{' '}
                      –{' '}
                      {rentalPackage.endsAt
                        ? new Date(rentalPackage.endsAt).toLocaleDateString()
                        : 'Ongoing'}
                    </small>
                  )}
                </div>
                <span
                  className={`admin-status ${rentalPackage.active ? 'is-active' : 'is-paused'}`}
                >
                  {rentalPackage.active ? 'Active' : 'Paused'}
                </span>
                <button
                  className="admin-row-action"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runAction(
                      () =>
                        api(`/api/admin/packages/${rentalPackage._id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ active: !rentalPackage.active }),
                        }),
                      rentalPackage.active ? 'Package paused.' : 'Package activated.',
                    )
                  }
                >
                  {rentalPackage.active ? 'Pause' : 'Activate'}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty text="Create a package to bundle vehicles and assets." />
        )}
      </section>
    </div>
  )
}
