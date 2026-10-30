import { useEffect, useRef, useState } from 'react'
import '../styles/product-gallery.css'

export default function ProductGallery({ product }) {
  return <Gallery key={product._id} product={product} />
}

function Gallery({ product }) {
  const photos = product.photos?.filter(Boolean) || []
  const [active, setActive] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const dialog = useRef(null)
  const opener = useRef(null)
  const touch = useRef(null)
  const swiped = useRef(false)
  const index = Math.min(active, Math.max(0, photos.length - 1))
  const select = (value) => { setActive((value + photos.length) % photos.length); setZoomed(false) }
  useEffect(() => {
    if (!fullscreen) return
    const element = dialog.current
    const trigger = opener.current
    element.showModal()
    return () => { element.close(); trigger?.focus() }
  }, [fullscreen])
  const onKeyDown = (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      select(index + (event.key === 'ArrowRight' ? 1 : -1))
    }
    if (event.key === 'Escape' && fullscreen) {
      event.stopPropagation()
      setFullscreen(false)
    }
  }
  const swipeHandlers = {
    onTouchStart: (event) => { touch.current = { x: event.touches[0]?.clientX, y: event.touches[0]?.clientY }; swiped.current = false },
    onTouchEnd: (event) => {
      const end = event.changedTouches[0]
      if (touch.current && end) {
        const dx = end.clientX - touch.current.x
        const dy = end.clientY - touch.current.y
        if (photos.length > 1 && Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
          select(index + (dx < 0 ? 1 : -1))
          swiped.current = true
        }
      }
      touch.current = null
    },
    onTouchCancel: () => { touch.current = null },
  }
  if (!photos.length) return <div className="product-detail-image-empty" role="img" aria-label="No product photo available">◇</div>
  const navigation = <>
    <button className="product-gallery-nav previous" type="button" onClick={() => select(index - 1)} aria-label="Previous image">‹</button>
    <button className="product-gallery-nav next" type="button" onClick={() => select(index + 1)} aria-label="Next image">›</button>
  </>
  return (
    <div className="product-gallery" role="region" aria-roledescription="carousel" aria-label={`${product.title} photos`} onKeyDown={onKeyDown}>
      <div className="product-gallery-stage" {...swipeHandlers}>
        <button className="product-gallery-main" type="button" ref={opener} onClick={() => { if (!swiped.current) { setZoomed(false); setFullscreen(true) } swiped.current = false }} aria-label="Open fullscreen image preview">
          <span className="product-gallery-track" style={{ transform: `translateX(-${index * 100}%)` }}>
            {photos.map((photo, position) => <img key={`${photo}-${position}`} className="product-detail-main-image" src={photo} alt={`${product.title} view ${position + 1}`} aria-hidden={position !== index} loading={position === 0 ? 'eager' : 'lazy'} draggable={false} />)}
          </span>
        </button>
        {photos.length > 1 && navigation}
        <span className="product-gallery-count" aria-live="polite" aria-atomic="true">{index + 1} / {photos.length}</span>
        <span className="product-gallery-hint" aria-hidden="true">Click to enlarge</span>
      </div>
      <div className="product-detail-thumbnails" aria-label="Product photo thumbnails">
        {photos.map((photo, position) => <button className={position === index ? 'active' : ''} type="button" key={`${photo}-${position}`} onClick={() => select(position)} aria-label={`Show image ${position + 1}`} aria-pressed={position === index}><img src={photo} alt="" loading="lazy" /></button>)}
      </div>
      {fullscreen && <dialog className="product-gallery-fullscreen" ref={dialog} aria-label={`${product.title} image preview`} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); setFullscreen(false) }} onClick={(event) => { if (event.target === event.currentTarget) setFullscreen(false) }}>
        <div className="product-gallery-lightbox-bar">
          <span>{product.title} · {index + 1} / {photos.length}</span>
          <button type="button" onClick={() => setFullscreen(false)} aria-label="Close image preview" autoFocus>×</button>
        </div>
        <div className="product-gallery-lightbox-stage" {...swipeHandlers}>
          <button className={`product-gallery-zoom${zoomed ? ' is-zoomed' : ''}`} type="button" onClick={() => setZoomed(!zoomed)} aria-label={zoomed ? 'Zoom out' : 'Zoom in'} aria-pressed={zoomed}><img src={photos[index]} alt={`${product.title} view ${index + 1}`} /></button>
          {photos.length > 1 && navigation}
        </div>
        <p>Use arrow keys to browse · Click the photo to zoom · Esc to close</p>
      </dialog>}
    </div>
  )
}
