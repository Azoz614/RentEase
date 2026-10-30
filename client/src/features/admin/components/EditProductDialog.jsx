import { useState } from 'react'
import ProductPhotoManager from '../../products/components/ProductPhotoManager.jsx'

export default function EditProductDialog({
  busy,
  editProduct,
  editingProduct,
  setEditingProduct,
}) {
  const [photos, setPhotos] = useState(() => (editingProduct.photos || []).map((data, index) => ({ data, name: `Saved photo ${index + 1}` })))
  const [readingPhotos, setReadingPhotos] = useState(false)
  return (
    <div
      className="admin-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setEditingProduct(null)
      }}
    >
      <section
        className="admin-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-product-title"
      >
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">LISTING DETAILS</span>
            <h2 id="edit-product-title">Edit product</h2>
          </div>
          <button
            type="button"
            className="admin-modal-close"
            aria-label="Close"
            onClick={() => setEditingProduct(null)}
          >
            ×
          </button>
        </div>
        <form className="admin-form" onSubmit={(event) => editProduct(event, photos.map((photo) => photo.data))}>
          <label>
            Product name
            <input name="title" defaultValue={editingProduct.title} maxLength="120" required />
          </label>
          <label>
            Category
            <input name="category" defaultValue={editingProduct.category} maxLength="80" required />
          </label>
          <label>
            Daily rental rate (LKR)
            <input
              name="dailyRate"
              type="number"
              min="0"
              step="1"
              defaultValue={editingProduct.dailyRate}
              required
            />
          </label>
          <label>
            Description
            <textarea
              name="description"
              rows="5"
              defaultValue={editingProduct.description}
              maxLength="3000"
              required
            />
          </label>
          <ProductPhotoManager photos={photos} setPhotos={setPhotos} disabled={busy} onReadingChange={setReadingPhotos} />
          <div className="admin-modal-actions">
            <button
              type="button"
              className="admin-secondary"
              onClick={() => setEditingProduct(null)}
            >
              Cancel
            </button>
            <button className="admin-primary" type="submit" disabled={busy || readingPhotos || !photos.length}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
