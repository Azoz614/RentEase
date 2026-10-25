import { useEffect, useState } from 'react'
import '../styles/product-gallery.css'

export default function ProductGallery({ product }) {
  const photos = product.photos?.filter(Boolean) || []
  const [active, setActive] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [touchStart, setTouchStart] = useState(null)
  useEffect(() => {
    setActive(0)
    setFullscreen(false)
  }, [product._id])
  if (!photos.length) return <div className="product-detail-image-empty">✳</div>
  const select = (index) => setActive((index + photos.length) % photos.length)
  const previous = () => select(active - 1)
  const next = () => select(active + 1)
  const main = (
    <img
      key={photos[active]}
      className="product-detail-main-image"
      src={photos[active]}
      alt={`${product.title} view ${active + 1}`}
    />
  )
  return (
    <div
      className="product-gallery"
      onTouchStart={(event) => setTouchStart(event.touches[0]?.clientX ?? null)}
      onTouchEnd={(event) => {
        const end = event.changedTouches[0]?.clientX
        if (touchStart != null && Math.abs(end - touchStart) > 40)
          (end < touchStart ? next : previous)()
        setTouchStart(null)
      }}
    >
      <button
        className="product-gallery-main"
        type="button"
        onClick={() => setFullscreen(true)}
        aria-label="Open fullscreen image preview"
      >
        {main}
      </button>
      {photos.length > 1 && (
        <>
          <button
            className="product-gallery-nav previous"
            type="button"
            onClick={previous}
            aria-label="Previous image"
          >
            ‹
          </button>
          <button
            className="product-gallery-nav next"
            type="button"
            onClick={next}
            aria-label="Next image"
          >
            ›
          </button>
          <div className="product-detail-thumbnails">
            {photos.map((photo, index) => (
              <button
                className={index === active ? 'active' : ''}
                type="button"
                key={photo}
                onClick={() => select(index)}
                aria-label={`Show image ${index + 1}`}
              >
                <img src={photo} alt="" />
              </button>
            ))}
          </div>
        </>
      )}
      {fullscreen && (
        <div
          className="product-gallery-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label={`${product.title} image preview`}
          onClick={() => setFullscreen(false)}
        >
          <button type="button" aria-label="Close image preview">
            ×
          </button>
          <div onClick={(event) => event.stopPropagation()}>
            {main}
            {photos.length > 1 && (
              <>
                <button
                  className="product-gallery-nav previous"
                  type="button"
                  onClick={previous}
                  aria-label="Previous image"
                >
                  ‹
                </button>
                <button
                  className="product-gallery-nav next"
                  type="button"
                  onClick={next}
                  aria-label="Next image"
                >
                  ›
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
