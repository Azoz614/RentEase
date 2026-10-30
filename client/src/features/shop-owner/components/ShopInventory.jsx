import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { formatCurrency as currency } from '../../../utils/currency.js'

export default function ShopInventory({
  busy,
  search,
  setSearch,
  onAddListing,
  toggleProduct,
  editPhotos,
  visibleProducts,
}) {
  return (
    <section className="workspace-card inventory-card">
      <div className="workspace-card-head">
        <div>
          <small className="workspace-kicker">PRODUCT CATALOG</small>
          <h2>Manage your listings</h2>
        </div>
        <button className="owner-primary" onClick={onAddListing}>
          <UiIcon name="plus" size={17} /> Add listing
        </button>
      </div>
      <div className="inventory-toolbar">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search your items"
        />
        <span>{visibleProducts.length} listings</span>
      </div>
      {visibleProducts.length ? (
        <div className="owner-inventory-grid">
          {visibleProducts.map((product) => (
            <article className="owner-inventory-card" key={product._id}>
              <div className="owner-inventory-image">
                {product.photos?.[0] && <img src={product.photos[0]} alt={product.title} />}
                <span className={product.active ? 'live-pill' : 'paused-pill'}>
                  {product.active ? 'Available' : 'Paused'}
                </span>
              </div>
              <div className="owner-inventory-info">
                <small>{product.category}</small>
                <h3>{product.title}</h3>
                <p>{product.description}</p>
                {product.specifications?.length > 0 && (
                  <ul className="owner-specs">
                    {product.specifications.slice(0, 3).map((spec) => (
                      <li key={`${spec.name}-${spec.value}`}>
                        <b>{spec.name}</b> {spec.value}
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  <b>{currency(product.dailyRate)}</b>
                  <span>/ day</span>
                  <span className="owner-deposit">Deposit {currency(product.depositAmount)}</span>
                </div>
                <button disabled={busy} onClick={() => toggleProduct(product)}>
                  {product.active ? 'Pause listing' : 'Publish listing'}
                </button>
                <button disabled={busy} onClick={() => editPhotos(product)}>
                  Edit photos ({product.photos?.length || 0})
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="workspace-empty">
          No listings found. Add a product to build your catalog.
        </div>
      )}
    </section>
  )
}
