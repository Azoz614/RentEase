import { useCallback, useEffect, useState } from 'react'
import { Stars } from '../../rentals/components/RentalReviewSection.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'

const average = (value) => Number(value || 0).toFixed(1)

export default function ShopReviews({ api }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('reviewed')
  const [open, setOpen] = useState(null)
  const load = useCallback(async () => {
    try {
      setData(await api('/api/owner/reviews'))
      setError('')
    } catch (failure) {
      setError(failure.message)
    }
  }, [api])
  useEffect(() => {
    queueMicrotask(load)
  }, [load])

  if (error)
    return (
      <div className="workspace-alert is-error" role="alert">
        {error}
        <button type="button" onClick={load}>
          Try again
        </button>
      </div>
    )
  if (!data) return <p role="status">Loading reviews…</p>
  const products = data.products.filter((product) => filter === 'all' || product.ratingCount > 0)
  // Each listing opens on its newest review; the owner can expand any listing to see every review.
  const expanded = open ?? products.find((product) => product.ratingCount)?._id
  return (
    <section className="sr-reviews">
      <div className="sr-summary">
        <div>
          <b>{average(data.summary.ratingAverage)}</b>
          <Stars rating={data.summary.ratingAverage} size={20} />
          <span>
            {data.summary.ratingCount} {data.summary.ratingCount === 1 ? 'review' : 'reviews'} across
            your listings
          </span>
        </div>
        <nav aria-label="Filter listings">
          <button type="button" aria-pressed={filter === 'reviewed'} onClick={() => setFilter('reviewed')}>
            Reviewed
          </button>
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All listings
          </button>
        </nav>
      </div>
      {!products.length && (
        <div className="workspace-empty">
          No reviews yet. Customers can rate an item after their rental ends.
        </div>
      )}
      {products.map((product) => {
        const isOpen = expanded === product._id
        return (
          <article className={`sr-product${isOpen ? ' is-open' : ''}`} key={product._id}>
            <button
              type="button"
              className="sr-product-head"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? '' : product._id)}
            >
              {product.photo ? <img src={product.photo} alt="" /> : <span className="sr-thumb" />}
              <span className="sr-product-title">
                <b>{product.title}</b>
                <small>{product.category}</small>
              </span>
              {product.ratingCount ? (
                <span className="sr-product-score">
                  <Stars rating={product.ratingAverage} />
                  <small>
                    {average(product.ratingAverage)} · {product.ratingCount}{' '}
                    {product.ratingCount === 1 ? 'review' : 'reviews'}
                  </small>
                </span>
              ) : (
                <small className="sr-none">No reviews yet</small>
              )}
              <UiIcon name="chevron" size={18} />
            </button>
            {isOpen && (
              <div className="sr-list">
                {product.reviews.length ? (
                  product.reviews.map((review) => (
                    <div className="sr-review" key={review._id}>
                      <div>
                        <span className="sr-avatar">{review.author[0]?.toUpperCase()}</span>
                        <b>{review.author}</b>
                        <Stars rating={review.rating} size={14} />
                        <time dateTime={review.createdAt}>
                          {new Date(review.createdAt).toLocaleDateString('en-LK', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </time>
                      </div>
                      <p>{review.comment || <em>No written comment.</em>}</p>
                    </div>
                  ))
                ) : (
                  <p className="sr-none">This listing has not been reviewed yet.</p>
                )}
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}
