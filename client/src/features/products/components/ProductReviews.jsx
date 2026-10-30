import { useEffect, useState } from 'react'
import { readJsonResponse } from '../../../services/http.js'
import '../styles/product-reviews.css'

function Stars({ rating }) {
  return <span className="product-review-stars" role="img" aria-label={`${Number(rating).toFixed(1)} out of 5 stars`}><span aria-hidden="true">★★★★★</span><span aria-hidden="true" style={{ width: `${Math.max(0, Math.min(5, rating)) * 20}%` }}>★★★★★</span></span>
}

export default function ProductReviews({ product }) {
  const [rating, setRating] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [attempt, setAttempt] = useState(0)
  const [response, setResponse] = useState(null)
  const params = new URLSearchParams({ sort, page: String(page) })
  if (rating !== 'all') params.set('rating', rating)
  const url = `/api/public/reviews/product/${product._id}?${params}`
  const requestKey = `${url}:${attempt}`
  useEffect(() => {
    const controller = new AbortController()
    let current = true
    fetch(url, { signal: controller.signal })
      .then((res) => readJsonResponse(res, 'Could not load reviews. Please try again.'))
      .then((data) => { if (current) setResponse({ key: requestKey, data }) })
      .catch((failure) => { if (current) setResponse((previous) => ({ key: requestKey, data: previous?.data, error: failure.message || 'Could not load reviews.' })) })
    return () => { current = false; controller.abort() }
  }, [url, requestKey])
  const loading = response?.key !== requestKey
  const error = loading ? '' : response?.error
  const result = response?.data
  const summary = result?.summary || { ratingAverage: product.ratingAverage || 0, ratingCount: product.ratingCount || 0, distribution: {} }
  const pagination = result?.pagination
  const reviews = result?.reviews || []
  return (
    <section className="product-reviews-panel" id="product-ratings" aria-labelledby="product-ratings-heading">
      <div className="product-reviews-title"><div><span className="market-kicker">FROM THE COMMUNITY</span><h3 id="product-ratings-heading">Ratings & reviews</h3></div><span>{summary.ratingCount} {summary.ratingCount === 1 ? 'review' : 'reviews'}</span></div>
      <div className="product-reviews-summary">
        <div className="product-reviews-score"><strong>{summary.ratingCount ? Number(summary.ratingAverage).toFixed(1) : '—'}<small> / 5</small></strong><Stars rating={summary.ratingAverage} /><span>{summary.ratingCount ? 'From completed rentals' : 'No ratings yet'}</span></div>
        <div className="product-reviews-distribution" aria-label="Rating breakdown">
          {[5, 4, 3, 2, 1].map((star) => <button key={star} type="button" disabled={loading || !result?.summary} aria-label={`Filter by ${star} stars`} aria-pressed={rating === String(star)} onClick={() => { setRating(rating === String(star) ? 'all' : String(star)); setPage(1) }}><span>{star} <span aria-hidden="true">★</span></span><span className="product-review-bar"><i style={{ width: `${summary.ratingCount ? (summary.distribution?.[star] || 0) / summary.ratingCount * 100 : 0}%` }} /></span><span>{summary.distribution?.[star] || 0}</span></button>)}
        </div>
      </div>
      <p className="product-reviews-policy">Only customers who complete a rental can leave a review. To rate your item, open the completed booking in My rentals.</p>
      <div className="product-reviews-toolbar">
        <label>Rating<select value={rating} onChange={(event) => { setRating(event.target.value); setPage(1) }}><option value="all">All ratings</option>{[5, 4, 3, 2, 1].map((star) => <option key={star} value={star}>{star} stars</option>)}</select></label>
        <label>Sort reviews<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}><option value="newest">Most recent</option><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option></select></label>
      </div>
      <div className="product-reviews-list" aria-busy={loading}>
        {loading ? <p role="status">Loading reviews…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry reviews</button></div> : reviews.length ? reviews.map((review) => <article className="product-review-card" key={review._id}>
          <div className="product-review-card-heading"><div><Stars rating={review.rating} /><b>{review.authorId?.username || 'Customer'}</b></div><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString('en-LK', { year: 'numeric', month: 'short', day: 'numeric' })}</time></div>
          <span className="product-review-verified">✓ Verified rental</span>
          {review.comment && <p>{review.comment}</p>}
        </article>) : <p className="product-reviews-empty">{rating === 'all' ? 'No reviews yet. Be the first to share your experience after a completed rental.' : 'No reviews with this rating. Try another star rating.'}</p>}
      </div>
      {!loading && !error && pagination?.pages > 1 && <nav className="product-reviews-pagination" aria-label="Review pages"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span aria-live="polite">Page {page} of {pagination.pages}</span><button type="button" disabled={page >= pagination.pages} onClick={() => setPage((value) => value + 1)}>Next</button></nav>}
    </section>
  )
}
