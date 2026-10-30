import { ProductRow } from './ProductRow.jsx'
import { Empty } from './Empty.jsx'

export default function ProductsPanel({
  busy,
  deleteProduct,
  exportCsv,
  holdProduct,
  productSearch,
  productStatus,
  products,
  setEditingProduct,
  setProductSearch,
  setProductStatus,
  visibleProducts,
}) {
  return (
    <div className="admin-work-grid admin-items-work-grid">
      <section className="admin-card">
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">INVENTORY</span>
            <h2>
              {products.filter((product) => product.active).length} active listing
              {products.filter((product) => product.active).length === 1 ? '' : 's'}
            </h2>
          </div>
          <button
            type="button"
            className="admin-text-button"
            onClick={() =>
              exportCsv('rentease-products.csv', [
                ['Product', 'Category', 'Daily rate LKR', 'Location', 'Status'],
                ...products.map((item) => [
                  item.title,
                  item.category,
                  item.dailyRate,
                  item.location,
                  item.active ? 'Active' : 'On hold',
                ]),
              ])
            }
          >
            Export CSV
          </button>
        </div>
        <div className="admin-toolbar">
          <input
            aria-label="Search listings"
            value={productSearch}
            onChange={(event) => setProductSearch(event.target.value)}
            placeholder="Search listings…"
          />
          <select
            aria-label="Filter listings by status"
            value={productStatus}
            onChange={(event) => setProductStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">On hold</option>
          </select>
        </div>
        {visibleProducts.length ? (
          <div className="admin-product-list">
            {visibleProducts.map((product) => (
              <ProductRow
                key={product._id}
                busy={busy}
                product={product}
                onEdit={() => setEditingProduct(product)}
                onToggle={() => holdProduct(product)}
                onDelete={() => deleteProduct(product)}
              />
            ))}
          </div>
        ) : (
          <Empty
            text={
              products.length
                ? 'No listings match those filters.'
                : 'Your published rentals will appear here.'
            }
          />
        )}
      </section>
    </div>
  )
}
