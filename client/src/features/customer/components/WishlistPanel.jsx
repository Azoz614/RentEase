import { RentalPhoto } from '../../products/components/RentalPhoto.jsx'
import { formatCurrency as money } from '../../../utils/currency.js'

export default function WishlistPanel({
  handleProductCardKey,
  openProductDetails,
  toggleWishlist,
  wishlist,
}) {
  return (
    <section className="requests-page">
      <span className="market-kicker">YOUR SAVED LISTINGS</span>
      <h1>Wishlist</h1>
      <p>Keep useful items together while you compare rental options.</p>
      {wishlist.length ? (
        <div className="product-grid wishlist-grid">
          {wishlist.map((item) => (
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
                      toggleWishlist(item)
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="market-empty">
          Save listings with the heart button and they will appear here.
        </div>
      )}
    </section>
  )
}
