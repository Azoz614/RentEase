import { useEffect, useRef } from 'react'
import { BrandMark } from '../../../components/ui/BrandMark.jsx'
import ProductDetailsContent from '../components/ProductDetailsContent.jsx'
import '../styles/product-page.css'

// Full-screen product page shown over the marketplace when a listing is opened.
export default function ProductPage({ product, onBack, children }) {
  const page = useRef(null)
  useEffect(() => {
    page.current?.scrollTo(0, 0)
    page.current?.focus()
  }, [product._id])
  useEffect(() => {
    const onKey = (event) => {
      // The gallery's own image preview closes first.
      if (event.key === 'Escape' && !document.querySelector('.product-gallery-fullscreen')) onBack()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onBack])
  return (
    <section className="product-page" ref={page} tabIndex={-1} aria-label={product.title}>
      <header className="product-page-bar">
        <button type="button" className="product-page-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back to rentals
        </button>
        <span className="product-page-brand">
          <BrandMark className="market-logo" />
          RentEase
        </span>
      </header>
      <div className="product-page-body">
        <ProductDetailsContent selectedProduct={product}>
          {children}
        </ProductDetailsContent>
      </div>
    </section>
  )
}
