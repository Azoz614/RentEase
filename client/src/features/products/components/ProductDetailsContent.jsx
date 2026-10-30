import ProductReviews from './ProductReviews.jsx'
import { ProductLocation } from '../../maps/components/ProductLocation.jsx'
import ProductGallery from './ProductGallery.jsx'

import { formatCurrency as money } from '../../../utils/currency.js'

export default function ProductDetailsContent({
  selectedProduct,
  children,
}) {
  return (
    <div className="product-detail-layout">
      <div className="product-detail-gallery">
        <ProductGallery product={selectedProduct} />
      </div>
      <div className="product-detail-copy">
        <span className="market-kicker">{selectedProduct.category}</span>
        <h2>{selectedProduct.title}</h2>
        <a className="product-detail-rating" href="#product-ratings">
          <b aria-label={`${Number(selectedProduct.ratingAverage || 0).toFixed(1)} out of 5 stars`}>
            ★ {Number(selectedProduct.ratingAverage || 0).toFixed(1)}
          </b>
          <span>
            {selectedProduct.ratingCount || 0}{' '}
            {Number(selectedProduct.ratingCount || 0) === 1 ? 'review' : 'reviews'}
          </span>
        </a>
        <p className="product-detail-description">{selectedProduct.description}</p>
        <div className="product-detail-price">
          <b>
            {money(selectedProduct.dailyRate)}
            <small> / day</small>
          </b>
          {selectedProduct.hourlyRate > 0 && (
            <span>{money(selectedProduct.hourlyRate)} / hour</span>
          )}
          {selectedProduct.weeklyRate > 0 && (
            <span>{money(selectedProduct.weeklyRate)} / week</span>
          )}
        </div>
        <div className="product-detail-facts">
          <div>
            <small>Rental shop</small>
            <b>
              {selectedProduct.providerId?.shopName ||
                selectedProduct.providerId?.username ||
                'Community provider'}
            </b>
          </div>
          <div>
            <small>Shop location</small>
            <b>{selectedProduct.location || 'Location not provided'}</b>
          </div>
          <div>
            <small>Lead time</small>
            <b>{selectedProduct.leadTimeHours ?? 24} hours</b>
          </div>
          <div>
            <small>Refundable deposit</small>
            <b>{money(selectedProduct.depositAmount)}</b>
          </div>
        </div>
        <ProductLocation product={selectedProduct} />
        {selectedProduct.specifications?.length > 0 && (
          <section className="product-detail-specs">
            <h3>Item details</h3>
            <dl>
              {selectedProduct.specifications.map((spec, index) => (
                <div key={`${spec.name}-${index}`}>
                  <dt>{spec.name}</dt>
                  <dd>{spec.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {children}
      </div>
      <ProductReviews key={selectedProduct._id} product={selectedProduct} />
    </div>
  )
}
