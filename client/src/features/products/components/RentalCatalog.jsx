import { NearbyRentals } from '../../maps/components/NearbyRentals.jsx'
import { IdentityStatusCard } from '../../identity/components/IdentityStatusCard.jsx'
import { productAvailabilityLabel } from '../../rentals/utils/rentalAvailability.js'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { RentalHero } from './RentalHero.jsx'
import { Disclosure } from '../../../components/ui/Disclosure.jsx'
import { RentalPhoto } from './RentalPhoto.jsx'
import { formatCurrency as money } from '../../../utils/currency.js'

export default function RentalCatalog({
  addToRequest,
  api,
  billingUnit,
  cart,
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
          <span>Search rentals</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Tools, cameras, event gear"
            list="rental-search-suggestions"
            autoComplete="off"
          />
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
          <span>Pricing</span>
          <select value={billingUnit} onChange={(event) => changeBillingUnit(event.target.value)}>
            <option value="day">By day / week</option>
            <option value="hour">By hour</option>
          </select>
        </label>
        <label>
          <span>Fulfilment</span>
          <select
            value={deliveryMethod}
            onChange={(event) => {
              setDeliveryMethod(event.target.value)
            }}
          >
            <option value="pickup">Self pickup</option>
            <option value="partner">Partner delivery</option>
          </select>
        </label>
        <button className="search-button" onClick={load}>
          <UiIcon name="search" size={17} />
          Find items
        </button>
      </section>
      <div className="re-discovery-row">
        <Disclosure
          icon="map"
          title="Explore nearby rentals"
          description="Find local shops and gear on the map"
        >
          <NearbyRentals
            api={api}
            onView={openProductDetails}
            startDate={startDate}
            endDate={endDate}
          />
        </Disclosure>
        {identityProfile?.eligible && (
          <Disclosure
            icon="shield"
            title="Your rental passport"
            description="Identity verified. Manage your saved addresses."
          >
            <IdentityStatusCard
              identity={identityProfile}
              onOpen={openVerification}
              onAddresses={openAddresses}
            />
          </Disclosure>
        )}
      </div>
      {!identityProfile?.eligible && (
        <IdentityStatusCard
          identity={identityProfile}
          onOpen={openVerification}
          onAddresses={openAddresses}
        />
      )}
      <div className="market-section-heading" id="rental-listings">
        <div className="re-listing-title">
          <span className="market-kicker">FIND YOUR NEXT GOOD THING</span>
          <h2>Made for your plans.</h2>
          <p>
            {productsLoading
              ? 'Finding things worth sharing...'
              : `${visible.length} rental items to explore`}
          </p>
          {search && (
            <small className="search-result-count">
              {visible.length} matching listings for {search}
            </small>
          )}
        </div>
        <div className="listing-filter">
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Choose a category to filter"
          >
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <button
            type="button"
            className="filter-button"
            onClick={() => setAppliedCategory(category)}
          >
            Filter items
          </button>
        </div>
      </div>
      {error && (
        <div className="market-alert error" role="alert">
          {error}
        </div>
      )}
      {message && (
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
            {visible.map((item) => (
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
                    aria-label={
                      wishlist.some((saved) => saved._id === item._id)
                        ? 'Remove from wishlist'
                        : 'Save to wishlist'
                    }
                    aria-pressed={wishlist.some((saved) => saved._id === item._id)}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleWishlist(item)
                    }}
                  >
                    <UiIcon
                      name="heart"
                      size={18}
                      fill={
                        wishlist.some((saved) => saved._id === item._id) ? 'currentColor' : 'none'
                      }
                    />
                  </button>
                  <RentalPhoto src={item.photos?.[0]} alt={item.title} />
                  <span className={`availability ${days && !item.available ? 'unavailable' : ''}`}>
                    {productAvailabilityLabel(item, Boolean(days))}
                  </span>
                </div>
                <div className="listing-info">
                  <div className="listing-meta">
                    <span>{item.category}</span>
                    <span>
                      {item.distanceKm == null
                        ? item.location
                        : `${item.distanceKm.toFixed(1)} km away`}
                    </span>
                  </div>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  {item.specifications?.length > 0 && (
                    <small className="listing-specs">
                      {item.specifications
                        .slice(0, 3)
                        .map((spec) => `${spec.name}: ${spec.value}`)
                        .join('\u00b7')}
                    </small>
                  )}
                  <div className="listing-bottom">
                    <div>
                      <b>
                        {money(
                          billingUnit === 'hour' && item.hourlyRate
                            ? item.hourlyRate
                            : item.dailyRate,
                        )}
                      </b>
                      <small>
                        {billingUnit === 'hour' && item.hourlyRate ? ' / hour' : ' / day'}
                      </small>
                      <small className="lead-time">
                        Typical lead time {item.leadTimeHours ?? 24}h
                      </small>
                      <small className="lead-time">Deposit {money(item.depositAmount || 0)}</small>
                      {item.weeklyRate > 0 && (
                        <small className="lead-time">
                          Weekly {money(item.weeklyRate)}
                          {item.longRentalDiscountPercent
                            ? ` \u00b7 ${item.longRentalDiscountPercent}% long-rental discount`
                            : ''}
                        </small>
                      )}
                    </div>
                    <button
                      disabled={
                        productsLoading ||
                        item.availabilityStatus === 'on_rental' ||
                        (Boolean(days) && !item.available) ||
                        cart.includes(item._id)
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        addToRequest(item)
                      }}
                    >
                      {cart.includes(item._id) ? (
                        'Added'
                      ) : item.availabilityStatus === 'on_rental' ? (
                        'On rental'
                      ) : !days ? (
                        'Choose rental dates'
                      ) : !item.available ? (
                        'Booked'
                      ) : (
                        <>
                          <UiIcon name="plus" size={14} /> Add to request
                        </>
                      )}
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
    </>
  )
}
