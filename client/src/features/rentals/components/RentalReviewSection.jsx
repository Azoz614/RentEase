import { useState } from 'react'

const labels = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

export function Stars({ rating, size = 16 }) {
  return (
    <span className="rv-stars" style={{ fontSize: size }} aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <i key={star} className={star <= Math.round(rating) ? 'is-on' : ''} aria-hidden="true">
          ★
        </i>
      ))}
    </span>
  )
}

function ReviewForm({ api, rental, item, onSaved }) {
  const [rating, setRating] = useState(0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = `rating-${rental._id}-${item.productId}`
  const submit = async (event) => {
    event.preventDefault()
    if (!rating) return setError('Choose a star rating.')
    setBusy(true)
    setError('')
    try {
      await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          requestId: rental._id,
          productId: item.productId,
          rating,
          comment: comment.trim(),
        }),
      })
      onSaved()
    } catch (failure) {
      setError(failure.message || 'Your review could not be saved. Please try again.')
      setBusy(false)
    }
  }
  const shown = hover || rating
  return (
    <form className="rv-form" onSubmit={submit}>
      <fieldset className="rv-star-input" onMouseLeave={() => setHover(0)}>
        <legend>Your rating for {item.title}</legend>
        {[1, 2, 3, 4, 5].map((star) => (
          <label key={star} className={star <= shown ? 'is-on' : ''} onMouseEnter={() => setHover(star)}>
            <input
              type="radio"
              name={name}
              value={star}
              checked={rating === star}
              aria-label={`${star} star${star === 1 ? '' : 's'}`}
              onChange={() => setRating(star)}
            />
            <span aria-hidden="true">★</span>
          </label>
        ))}
        <b className="rv-star-label">{labels[shown] || 'Tap a star'}</b>
      </fieldset>
      <label className="rv-comment">
        <span>Tell other renters about it (optional)</span>
        <textarea
          value={comment}
          maxLength={1200}
          rows={3}
          placeholder="Condition of the item, how the pickup went, anything worth knowing"
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      {error && (
        <p className="rv-error" role="alert">
          {error}
        </p>
      )}
      <button className="cr-button cr-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Submit review'}
      </button>
    </form>
  )
}

export function RentalReviewSection({ api, rental, onSaved }) {
  const items = rental.items.filter((item) => item.reviewable || item.review)
  if (!items.length) return null
  const waiting = items.filter((item) => item.reviewable).length
  return (
    <section className="cr-detail-section rv-section" aria-label="Rate your rental">
      <h3>{waiting ? 'How was your rental?' : 'Your reviews'}</h3>
      <p className="rv-intro">
        {waiting
          ? 'Your rating helps other renters choose and helps the shop improve.'
          : 'Thank you for rating your rental.'}
      </p>
      {items.map((item) => (
        <article className="rv-item" key={String(item.productId)}>
          <div className="rv-item-head">
            {item.image ? <img src={item.image} alt="" /> : <span className="rv-item-thumb" />}
            <b>{item.title}</b>
          </div>
          {item.review ? (
            <div className="rv-saved">
              <Stars rating={item.review.rating} size={18} />
              {item.review.comment && <p>{item.review.comment}</p>}
              <small>Reviewed on {new Date(item.review.createdAt).toLocaleDateString('en-LK')}</small>
            </div>
          ) : (
            <ReviewForm api={api} rental={rental} item={item} onSaved={onSaved} />
          )}
        </article>
      ))}
    </section>
  )
}
