import { useState } from 'react'

export function ProductRow({ product, onEdit, onToggle }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const showDetails = () => setDetailsOpen(true)
  return (
    <>
      <article
        className="admin-product-row admin-product-row-selectable"
        role="button"
        tabIndex={0}
        onClick={showDetails}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            showDetails()
          }
        }}
      >
        <img src={product.photos?.[0]} alt="" />
        <div className="admin-product-info">
          <b>{product.title}</b>
          <span>
            {product.category} · {product.location}
          </span>
          <small>
            LKR {Number(product.dailyRate).toLocaleString()} / day{' '}
            <span className={`admin-status ${product.active ? 'is-active' : 'is-paused'}`}>
              {product.active ? 'Active' : 'Inactive'}
            </span>
          </small>
        </div>
        <button
          className="admin-row-action"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            showDetails()
          }}
        >
          View details
        </button>
      </article>
      {detailsOpen && (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetailsOpen(false)
          }}
        >
          <section
            className="admin-modal admin-item-details"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`item-details-${product._id}`}
          >
            <div className="admin-card-heading">
              <div>
                <span className="admin-kicker">{product.category}</span>
                <h2 id={`item-details-${product._id}`}>{product.title}</h2>
              </div>
              <button
                type="button"
                className="admin-modal-close"
                aria-label="Close"
                onClick={() => setDetailsOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="admin-detail-gallery">
              {product.photos?.map((photo) => (
                <img key={photo} src={photo} alt={product.title} />
              ))}
            </div>
            <div className="admin-item-summary">
              <b>LKR {Number(product.dailyRate || 0).toLocaleString()} / day</b>
              <span className={`admin-status ${product.active ? 'is-active' : 'is-paused'}`}>
                {product.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p>{product.description}</p>
            <dl className="admin-item-details-list">
              <div>
                <dt>Location</dt>
                <dd>{product.location || 'Batticaloa'}</dd>
              </div>
              <div>
                <dt>Preparation time</dt>
                <dd>{product.leadTimeHours ?? 24} hours</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>
                  {product.createdAt
                    ? new Date(product.createdAt).toLocaleDateString()
                    : 'Not available'}
                </dd>
              </div>
              {product.specifications?.map((spec) => (
                <div key={`${spec.name}-${spec.value}`}>
                  <dt>{spec.name}</dt>
                  <dd>{spec.value}</dd>
                </div>
              ))}
            </dl>
            <div className="admin-modal-actions">
              {onToggle && (
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => {
                    onToggle()
                    setDetailsOpen(false)
                  }}
                >
                  {product.active ? 'Deactivate' : 'Activate'}
                </button>
              )}
              {onEdit && (
                <button
                  type="button"
                  className="admin-primary"
                  onClick={() => {
                    setDetailsOpen(false)
                    onEdit()
                  }}
                >
                  Edit details
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  )
}
