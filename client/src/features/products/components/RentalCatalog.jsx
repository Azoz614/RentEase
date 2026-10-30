import { NearbyRentals } from '../../maps/components/NearbyRentals.jsx'
import { IdentityStatusCard } from '../../identity/components/IdentityStatusCard.jsx'
import { productAvailabilityLabel } from '../../rentals/utils/rentalAvailability.js'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { RentalHero } from './RentalHero.jsx'
import { Disclosure } from '../../../components/ui/Disclosure.jsx'
import { RentalPhoto } from './RentalPhoto.jsx'
import { formatCurrency as money } from '../../../utils/currency.js'
import { providerOf, shopNameOf } from '../../rentals/utils/rentalShop.js'

export default function RentalCatalog({
  addToRequest,
  removeFromCart,
  api,
  billingUnit,
  cart,
  cartShop = null,
  categories,
  category,
  changeBillingUnit,
  days,
  deliveryMethod,
  endDate,
  endDateInput,
  error,
  handleProductCardKey,
  identityProfile,
  load,
  message,
  openAddresses,
  openProductDetails,
  openVerification,
  productsLoading,
  search,
  searchSuggestions,
  setAppliedCategory,
  setCart,
  setCategory,
  setDeliveryMethod,
  setEndDate,
  setSearch,
  setStartDate,
  startDate,
  today,
  toggleWishlist,
  visible,
  wishlist,
}) {
  const chooseCategory = (value) => {
    setCategory(value)
    setAppliedCategory(value)
  }
  return (
    <>
      <RentalHero
        returning
        onExplore={() =>
          document.getElementById('rental-listings')?.scrollIntoView({ behavior: 'smooth' })
        }
      />
      <section className="search-panel" aria-label="Search rentals">
        <label className="search-field">
          <span>What do you need?</span>
          <span className="search-input">
            <UiIcon name="search" size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tools, cameras, event gear"
              list="rental-search-suggestions"
              autoComplete="off"
            />
          </span>
          <datalist id="rental-search-suggestions">
            {searchSuggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </label>
        <label>
          <span>From</span>
          <input
            type={billingUnit === 'hour' ? 'datetime-local' : 'date'}
            min={billingUnit === 'hour' ? today + 'T00:00' : today}
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value)
              setCart([])
            }}
          />
        </label>
        <label>
          <span>Until</span>
          <input
            ref={endDateInput}
            type={billingUnit === 'hour' ? 'datetime-local' : 'date'}
            min={startDate || today}
            value={endDate}
            onChange={(event) => {
              setEndDate(event.target.value)
              setCart([])
            }}
          />
        </label>
        <label>
          <span>Rent by</span>
          <select value={billingUnit} onChange={(event) => changeBillingUnit(event.target.value)}>
            <option value="day">Day or week</option>
            <option value="hour">Hour</option>
          </select>
        </label>
        <label>
          <span>Get it by</span>
          <select
            value={deliveryMethod}
            onChange={(event) => {
              setDeliveryMethod(event.target.value)
            }}
          >
            <option value="" disabled>Pickup or delivery</option>
            <option value="pickup">Pickup from shop</option>
            <option value="partner">Delivery to me</option>
          </select>
        </label>
        <button className="search-button" onClick={load}>
          <UiIcon name="search" size={17} />
          Search
        </button>
      </section>
      {!identityProfile?.eligible && <div id="rental-verification-notice">
        {message && <p className="iv-alert" role="status">{message}</p>}
        <IdentityStatusCard
          identity={identityProfile}
          onOpen={openVerification}
          onAddresses={openAddresses}
        />
      </div>}
      <div className="market-section-heading" id="rental-listings">
        <div className="re-listing-title">
          <h2>{search ? `Results for “${search}”` : 'All rentals'}</h2>
          <p>
            {productsLoading
              ? 'Loading rentals…'
              : `${visible.length} ${visible.length === 1 ? 'item' : 'items'}`}
          </p>
        </div>
      </div>
      {categories.length > 0 && (
        <div className="category-chips" role="group" aria-label="Filter by category">
          {['all', ...categories].map((item) => (
            <button
              type="button"
              key={item}
              aria-pressed={category === item}
              onClick={() => chooseCategory(item)}
            >
              {item === 'all' ? 'All' : item}
            </button>
          ))}
        </div>
      )}
      <Disclosure
        icon="map"
        title="Find nearby rentals"
        description="Choose your area and compare items in a list or on the map"
      >
        <NearbyRentals
          api={api}
          onView={openProductDetails}
          startDate={startDate}
          endDate={endDate}
        />
      </Disclosure>
      {error && (
        <div className="market-alert error" role="alert">
          {error}
        </div>
      )}
      {message && identityProfile?.eligible && (
        <div className="market-alert success" role="status">
          {message}
        </div>
      )}
      <div
        className={`product-grid${productsLoading ? ' product-grid-loading' : search ? ' product-grid-searching' : ''}`}
        aria-busy={productsLoading}
      >
        {productsLoading ? (
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
            {visible.map((item) => {
              const saved = wishlist.some((entry) => entry._id === item._id)
              const hourly = billingUnit === 'hour' && item.hourlyRate
              // One request = one shop; items from another shop start a new request.
              const otherShop = Boolean(cartShop) && cartShop.id !== providerOf(item)
              return (
                <article
                  className="listing-card"
                  key={item._id}
                  onClick={() => openProductDetails(item)}
                  onKeyDown={(event) => handleProductCardKey(event, item)}
                  tabIndex={0}
                >
                  <div className="listing-image">
                    <button
                      type="button"
                      className="wishlist-toggle"
                      aria-label={saved ? 'Remove from wishlist' : 'Save to wishlist'}
                      aria-pressed={saved}
                      onClick={(event) => {
                        event.stopPropagation()
                        toggleWishlist(item)
                      }}
                    >
                      <UiIcon name="heart" size={18} fill={saved ? 'currentColor' : 'none'} />
                    </button>
                    <RentalPhoto src={item.photos?.[0]} alt={item.title} />
                    {item.photos?.length > 1 && <span className="listing-image-count">{item.photos.length} photos</span>}
                    <span className={`availability ${days && !item.available ? 'unavailable' : ''}`}>
                      {productAvailabilityLabel(item, Boolean(days))}
                    </span>
                  </div>
                  <div className="listing-info">
                    <div className="listing-meta">
                      <span>{item.category}</span>
                      <span>
                        <UiIcon name="pin" size={13} />
                        {item.distanceKm == null
                          ? item.location
                          : `${item.distanceKm.toFixed(1)} km away`}
                      </span>
                    </div>
                    <h3>{item.title}</h3>
                    <span className={`listing-shop${otherShop ? ' is-other' : cartShop ? ' is-current' : ''}`}>
                      <UiIcon name="store" size={13} />
                      {shopNameOf(item)}
                      {cartShop && <small>{otherShop ? 'Other shop' : 'In your request'}</small>}
                    </span>
                    {item.ratingCount > 0 ? (
                      <span
                        className="listing-rating"
                        aria-label={`Rated ${Number(item.ratingAverage).toFixed(1)} out of 5 from ${item.ratingCount} ${item.ratingCount === 1 ? 'review' : 'reviews'}`}
                      >
                        <i aria-hidden="true">★</i> {Number(item.ratingAverage).toFixed(1)}
                        <small>
                          ({item.ratingCount} {item.ratingCount === 1 ? 'review' : 'reviews'})
                        </small>
                      </span>
                    ) : (
                      <span className="listing-rating is-new">New · no reviews yet</span>
                    )}
                    <p>{item.description}</p>
                    <div className="listing-bottom">
                      <div className="listing-price">
                        <b>{money(hourly ? item.hourlyRate : item.dailyRate)}</b>
                        <small>{hourly ? ' / hour' : ' / day'}</small>
                      </div>
                      {cart.includes(item._id) ? (
                        <button
                          className="listing-added"
                          aria-label={`Remove ${item.title} from your request`}
                          title="Remove from your request"
                          onClick={(event) => {
                            event.stopPropagation()
                            removeFromCart(item._id)
                          }}
                        >
                          <span className="listing-added-label">
                            <UiIcon name="check" size={14} /> Added
                          </span>
                          <span className="listing-remove-label">
                            <UiIcon name="close" size={14} /> Remove
                          </span>
                        </button>
                      ) : (
                        <button
                          className={otherShop ? 'listing-add-other' : undefined}
                          title={otherShop ? `Your request has items from ${cartShop.name}. This item starts a new request.` : undefined}
                          disabled={
                            productsLoading ||
                            item.availabilityStatus === 'on_rental' ||
                            (Boolean(days) && !item.available)
                          }
                          onClick={(event) => {
                            event.stopPropagation()
                            addToRequest(item)
                          }}
                        >
                          {item.availabilityStatus === 'on_rental' ? (
                            'On rental'
                          ) : !days ? (
                            'Choose rental dates'
                          ) : !item.available ? (
                            'Booked'
                          ) : otherShop ? (
                            <>
                              <UiIcon name="refresh" size={14} /> New request
                            </>
                          ) : (
                            <>
                              <UiIcon name="plus" size={14} /> Add to request
                            </>
                          )}
                        </button>
                      )}
                    </div>
                    <ul className="listing-terms">
                      <li>Deposit {money(item.depositAmount || 0)}</li>
                      {item.weeklyRate > 0 && (
                        <li>
                          Weekly {money(item.weeklyRate)}
                          {item.longRentalDiscountPercent
                            ? ` (${item.longRentalDiscountPercent}% off long rentals)`
                            : ''}
                        </li>
                      )}
                      <li>Ready in {item.leadTimeHours ?? 24}h</li>
                    </ul>
                  </div>
                </article>
              )
            })}
            {!visible.length && (
              <div className="market-empty">
                <b>No rentals match your search</b>
                <span>Try another word, a different category or other dates.</span>
                {(search || category !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('')
                      chooseCategory('all')
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
