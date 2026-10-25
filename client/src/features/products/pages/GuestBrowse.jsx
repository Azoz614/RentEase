import { useEffect, useState } from 'react'
import { readJsonResponse } from '../../../services/http.js'
import { BrandMark } from '../../../components/ui/BrandMark.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { RentalHero } from '../components/RentalHero.jsx'
import { RentalPhoto } from '../components/RentalPhoto.jsx'

import { formatCurrency as money } from '../../../utils/currency.js'

import ProductDetailsContent from '../components/ProductDetailsContent.jsx'

export function GuestBrowse({ onSignIn }) {
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [productReviews, setProductReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  useEffect(() => {
    let active = true
    fetch('/api/public/products')
      .then((response) => readJsonResponse(response, 'Could not load listings.'))
      .then((result) => {
        if (active) setProducts(result.products || [])
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  const normalize = (text) =>
    String(text || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  const categories = [...new Set(products.map((item) => item.category))].sort()
  const terms = normalize(search).trim().split(/\s+/).filter(Boolean)
  const visible = products.filter((item) => {
    const searchable = normalize(
      `${item.title} ${item.category} ${item.description} ${item.location}`,
    )
    return (
      terms.every((term) => searchable.includes(term)) &&
      (category === 'all' || item.category === category)
    )
  })
  const suggestions = [...new Set([...categories, ...products.map((item) => item.title)])]
    .filter((item) => search.trim() && normalize(item).includes(normalize(search).trim()))
    .slice(0, 8)
  const openProductDetails = async (product) => {
    setSelectedProduct(product)
    setProductReviews([])
    setReviewsLoading(true)
    document.getElementById('guest-product-details')?.showModal()
    try {
      const result = await readJsonResponse(
        await fetch(`/api/public/reviews/product/${product._id}`),
        'Could not load reviews.',
      )
      setProductReviews(result.reviews || [])
    } catch {
      setProductReviews([])
    } finally {
      setReviewsLoading(false)
    }
  }
  const handleProductCardKey = (event, product) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
      event.preventDefault()
      openProductDetails(product)
    }
  }

  return (
    <main className="marketplace guest-marketplace">
      <header className="market-nav">
        <a className="market-brand" href="/">
          <BrandMark className="market-logo" />
          RentEase
        </a>
        <nav aria-label="Main navigation">
          <a className="guest-nav-current" href="#browse">
            Explore
          </a>
        </nav>
        <div className="market-actions">
          <button className="market-logout" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </header>
      <div className="market-content" id="browse">
        <RentalHero
          onExplore={() =>
            document.getElementById('guest-listings')?.scrollIntoView({ behavior: 'smooth' })
          }
        />
        <section className="search-panel guest-search" aria-label="Search rentals">
          <label className="search-field">
            <span>Search rentals</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Try cameras or tools"
              list="guest-search-suggestions"
              autoComplete="off"
            />
            <datalist id="guest-search-suggestions">
              {suggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>
          <button
            className="search-button"
            onClick={() =>
              document.getElementById('guest-listings')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            <UiIcon name="search" size={17} />
            Find items
          </button>
        </section>
        <div className="market-section-heading" id="guest-listings">
          <div className="re-listing-title">
            <span className="market-kicker">THE LOCAL RENTAL EDIT</span>
            <h2>Good gear. Ready for you.</h2>
            <p>
              {loading
                ? 'Finding things worth sharing...'
                : `${visible.length} rental items to explore`}
            </p>
            {search && (
              <small className="search-result-count">
                {visible.length} matching listings for {search}
              </small>
            )}
          </div>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </div>
        {error && (
          <div className="market-alert error" role="alert">
            {error}
          </div>
        )}
        <div
          className={`product-grid${loading ? ' product-grid-loading' : search ? ' product-grid-searching' : ''}`}
          aria-busy={loading}
        >
          {loading ? (
            Array.from({ length: 6 }, (_, index) => (
              <div className="listing-skeleton" key={index}>
                <div className="skeleton-image" />
                <div className="skeleton-lines">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ))
          ) : (
            <>
              {visible.map((item) => (
                <article
                  className="listing-card"
                  key={item._id}
                  onClick={() => openProductDetails(item)}
                  onKeyDown={(event) => handleProductCardKey(event, item)}
                  tabIndex={0}
                >
                  <div className="listing-image">
                    <RentalPhoto src={item.photos?.[0]} alt={item.title} />
                  </div>
                  <div className="listing-info">
                    <div className="listing-meta">
                      <span>{item.category}</span>
                      <span>{item.location}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <p>{item.description}</p>
                    <div className="listing-bottom">
                      <div>
                        <b>{money(item.dailyRate)}</b>
                        <small> / day</small>
                      </div>
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          onSignIn()
                        }}
                      >
                        Sign in to rent
                      </button>
                    </div>
                  </div>
                </article>
              ))}
              {!visible.length && (
                <div className="market-empty">No listings match those filters.</div>
              )}
            </>
          )}
        </div>
      </div>
      <dialog
        className="product-detail-dialog"
        id="guest-product-details"
        onClose={() => setSelectedProduct(null)}
      >
        <form method="dialog" className="dialog-close">
          <button aria-label="Close item details">Close</button>
        </form>
        {selectedProduct && (
          <ProductDetailsContent
            selectedProduct={selectedProduct}
            productReviews={productReviews}
            reviewsLoading={reviewsLoading}
          >
            <button type="button" className="checkout-submit product-detail-add" onClick={onSignIn}>
              Sign in to rent this item
            </button>
          </ProductDetailsContent>
        )}
      </dialog>
    </main>
  )
}
