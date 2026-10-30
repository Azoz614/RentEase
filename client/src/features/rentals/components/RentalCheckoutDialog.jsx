import { rentalPrice } from '../utils/rentalPricing.js'
import { loyaltyRewardAmount } from '../../loyalty/utils/loyalty.js'
import { localDateTimeNow } from '../utils/rentalAvailability.js'
import { CheckoutLocation } from '../../maps/components/CheckoutLocation.jsx'
import { QuoteBreakdown } from '../../maps/components/QuoteBreakdown.jsx'
import { addressText } from '../../identity/utils/address.js'
import { formatCurrencyFixed as money } from '../../../utils/currency.js'
import '../styles/rental-checkout.css'

export default function RentalCheckoutDialog({
  appliedCoupon,
  applyCoupon,
  billingUnit,
  busy,
  calculateDelivery,
  cartProducts,
  checkout,
  couponInput,
  couponMessage,
  days,
  deliveryMethod,
  deliverySelection,
  durationLabel,
  endDate,
  error,
  feeQuote,
  hours,
  identityProfile,
  mapsConfigured,
  openProfileSettings,
  openVerification,
  profileReady,
  setAppliedCoupon,
  setCouponInput,
  setCouponMessage,
  setDeliveryMethod,
  setDeliverySelection,
  startDate,
  subtotal,
  setStartDate,
  setEndDate,
  quoteLoading,
  quoteError,
  removeFromCart,
  today,
  loyalty,
  rewardProductId = '',
  setRewardChoice,
  loyaltyDiscount: localLoyaltyDiscount = 0,
  cartShop = null,
}) {
  const delivery = deliveryMethod === 'partner'
  const pricing = delivery ? feeQuote?.pricing : null
  const rentalSubtotal = pricing?.subtotal ?? subtotal
  const loyaltyDiscount = pricing?.loyaltyDiscount ?? localLoyaltyDiscount
  const fullPrice = (item) => rentalPrice(item, days, billingUnit === 'hour' ? hours : null)
  const itemPrice = (item) =>
    pricing?.items?.find((entry) => entry.productId === item._id)?.rentalAmount ??
    fullPrice(item) - (item._id === rewardProductId ? localLoyaltyDiscount : 0)
  const discount =
    pricing?.discountAmount ??
    (appliedCoupon?.subtotal === subtotal ? appliedCoupon.discountAmount : 0)
  const total = !deliveryMethod ? null : delivery
    ? feeQuote
      ? (pricing?.total ??
        rentalSubtotal - discount + feeQuote.deliveryFee + (feeQuote.returnCollectionFee || 0))
      : null
    : rentalSubtotal - discount
  const saved =
    identityProfile?.addresses?.find((entry) => entry._id === deliverySelection.addressId) ||
    (!deliverySelection.addressId ? identityProfile?.defaultAddress : null)
  const destinationAddress =
    deliverySelection.destination?.address || (saved ? addressText(saved) : '')
  const deposits =
    pricing?.depositAmount ??
    cartProducts.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0)
  const invalidPeriod = !Number.isFinite(hours) || hours <= 0 || startDate.slice(0, 10) < today
  // Hourly bookings cannot start in the past.
  const nowLocal = localDateTimeNow()

  return (
    <dialog className="checkout-dialog rental-checkout" id="rental-checkout">
      <form method="dialog" className="dialog-close">
        <button aria-label="Close rental request">Close</button>
      </form>
      <span className="market-kicker">REVIEW & SEND</span>
      <h2>Your rental request</h2>
      {profileReady ? (
        <div className="checkout-profile-summary">
          <span>Identity approved · residential address saved.</span>
          <button type="button" onClick={() => openProfileSettings()}>
            Edit profile details
          </button>
        </div>
      ) : (
        <div className="market-alert error" role="alert">
          <p>
            {identityProfile?.message ||
              'Complete NIC verification and save a residential address before requesting a rental.'}
          </p>
          <button type="button" onClick={openVerification}>
            Complete verification
          </button>
        </div>
      )}
      <div className="rental-checkout-layout">
        <div className="rental-checkout-details">
          <section className="checkout-section">
            <h3>Rental period</h3>
            <div className="checkout-date-grid">
              <label>
                From
                <input
                  aria-label="Rental start"
                  type={billingUnit === 'hour' ? 'datetime-local' : 'date'}
                  min={billingUnit === 'hour' ? nowLocal : today}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </label>
              <label>
                Until
                <input
                  aria-label="Rental end"
                  type={billingUnit === 'hour' ? 'datetime-local' : 'date'}
                  min={startDate}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>
            <p className="checkout-period">
              {invalidPeriod ? 'Choose an end date after the start date.' : durationLabel}
            </p>
          </section>
          <section className="checkout-section">
            <h3>How would you like to receive your rental?</h3>
            <div className="delivery-options">
              <label>
                <input
                  type="radio"
                  name="delivery"
                  checked={deliveryMethod === 'pickup'}
                  onChange={() => setDeliveryMethod('pickup')}
                />
                <span>
                  <b>Self Pickup</b>
                  <small>No delivery fee</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="delivery"
                  checked={delivery}
                  onChange={() => setDeliveryMethod('partner')}
                />
                <span>
                  <b>Delivery Partner</b>
                  <small>Rs. 50 per driving kilometer</small>
                </span>
              </label>
            </div>
          </section>
          {delivery && (
            <CheckoutLocation
              addresses={identityProfile?.addresses}
              defaultAddress={identityProfile?.defaultAddress}
              selection={deliverySelection}
              onChange={setDeliverySelection}
            />
          )}
        </div>
        <aside className="rental-order-summary" aria-label="Order summary">
          <span className="market-kicker">YOUR BOOKING</span>
          <h3>Order summary</h3>
          <p>
            {invalidPeriod ? 'Select your rental dates' : durationLabel} · {cartProducts.length}{' '}
            {cartProducts.length === 1 ? 'item' : 'items'}
          </p>
          {cartShop && (
            <p className="checkout-shop-note">
              All items from <b>{cartShop.name}</b> ·{' '}
              {delivery ? 'delivered together by one rider' : 'picked up together in one visit'}
            </p>
          )}
          <div className="checkout-items">
            {cartProducts.map((item) => (
              <div key={item._id} className={item._id === rewardProductId ? 'checkout-item-rewarded' : ''}>
                <span>
                  {item.title}
                  {item._id === rewardProductId && (
                    <small className="checkout-reward-tag">−{loyalty?.rewardPercent ?? 2}% level reward</small>
                  )}
                </span>
                <b>{money(itemPrice(item))}</b>
                {removeFromCart && (
                  <button type="button" className="checkout-remove" disabled={busy}
                    aria-label={`Remove ${item.title}`} onClick={() => removeFromCart(item._id)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {delivery && (
            <div className="checkout-destination">
              <span>Delivery address</span>
              <p>{destinationAddress || 'Choose a map location and enter its delivery address.'}</p>
            </div>
          )}
          {delivery && quoteLoading && (
            <div
              className="checkout-route-loading"
              role="status"
              aria-live="polite"
              aria-busy="true"
            >
              <span className="checkout-loading-bar" />
              <span className="checkout-loading-bar" />
              <p>Calculating driving route, delivery fee and arrival estimate…</p>
            </div>
          )}
          {delivery && !mapsConfigured && !feeQuote && !quoteLoading && !quoteError && (
            <p className="re-map-error" role="alert">
              Delivery routing is temporarily unavailable. Try again or choose Self Pickup.
            </p>
          )}
          {delivery && quoteError && (
            <div className="checkout-route-error" role="alert">
              <p>{quoteError}</p>
              <button type="button" onClick={calculateDelivery}>
                Try route again
              </button>
            </div>
          )}
          {delivery && !feeQuote && !quoteLoading && !quoteError && mapsConfigured && (
            <p className="fee-note">
              Choose a delivery pin and enter its address. Your quote updates automatically.
            </p>
          )}
          {delivery && <QuoteBreakdown quote={feeQuote} />}
          {loyalty?.rewardsAvailable > 0 && cartProducts.length > 0 && setRewardChoice && (
            <label className="checkout-reward-picker">
              <span>
                <b>Level reward · {loyalty.rewardPercent}% off one item</b>
                <small>
                  {loyalty.rewardsAvailable} {loyalty.rewardsAvailable === 1 ? 'reward' : 'rewards'} ready
                </small>
              </span>
              <select
                aria-label="Apply level reward to"
                value={rewardProductId}
                disabled={busy}
                onChange={(event) => setRewardChoice(event.target.value)}
              >
                <option value="">Keep it for later</option>
                {cartProducts.map((item) => (
                  <option key={item._id} value={item._id}>
                    {item.title} (save {money(loyaltyRewardAmount(fullPrice(item)))})
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="coupon-entry">
            <label>
              Coupon code
              <input
                value={couponInput}
                onChange={(event) => {
                  setCouponInput(event.target.value.toUpperCase())
                  setAppliedCoupon(null)
                  setCouponMessage('')
                }}
                placeholder="Enter code"
              />
            </label>
            <button
              type="button"
              disabled={busy || !couponInput.trim() || !subtotal}
              onClick={applyCoupon}
            >
              Apply
            </button>
          </div>
          {couponMessage && (
            <small
              className={appliedCoupon?.subtotal === subtotal ? 'coupon-success' : 'coupon-error'}
            >
              {couponMessage}
            </small>
          )}
          <div className="checkout-total">
            <span>Rental charges</span>
            <b>{money(rentalSubtotal + loyaltyDiscount)}</b>
          </div>
          {loyaltyDiscount > 0 && (
            <div className="checkout-total coupon-total">
              <span>Level reward ({loyalty?.rewardPercent ?? 2}%)</span>
              <b>−{money(loyaltyDiscount)}</b>
            </div>
          )}
          {discount > 0 && (
            <div className="checkout-total coupon-total">
              <span>Coupon discount</span>
              <b>−{money(discount)}</b>
            </div>
          )}
          <div className="checkout-total">
            <span>
              Delivery{' '}
              {delivery && feeQuote ? '(' + feeQuote.distanceKm.toFixed(2) + ' km × Rs. 50)' : ''}
            </span>
            <b>
              {delivery ? (feeQuote ? money(feeQuote.deliveryFee) : 'Pending route') : money(0)}
            </b>
          </div>
          {delivery && feeQuote?.returnCollectionFee > 0 && (
            <div className="checkout-total">
              <span>Return collection</span>
              <b>{money(feeQuote.returnCollectionFee)}</b>
            </div>
          )}
          <div className="checkout-total checkout-grand-total" aria-live="polite">
            <span>Final total</span>
            <b>
              {total === null ? (!deliveryMethod ? 'Choose a delivery method' : quoteLoading ? 'Calculating…' : 'Awaiting route') : money(total)}
            </b>
          </div>
          {deposits > 0 && (
            <small className="fee-note">
              Refundable deposit: {money(deposits)}. Handled separately under the existing payment
              rules; excluded from this total.
            </small>
          )}
          {error && (
            <div className="market-alert error" role="alert">
              {error}
            </div>
          )}
          <button
            type="button"
            className="checkout-submit"
            disabled={
              busy ||
              invalidPeriod ||
              !cartProducts.length ||
              !profileReady ||
              !deliveryMethod ||
              (delivery && (quoteLoading || !feeQuote))
            }
            onClick={checkout}
          >
            {busy ? 'Sending request…' : 'Confirm rental request'}
          </button>
        </aside>
      </div>
    </dialog>
  )
}
