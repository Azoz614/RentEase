import DeliveryTaskBoard from '../../delivery-partner/components/DeliveryTaskBoard.jsx'
import useMarketplace from '../hooks/useMarketplace.js'
import CustomerNavigation from '../components/CustomerNavigation.jsx'
import RentalCatalog from '../../products/components/RentalCatalog.jsx'
import WishlistPanel from '../components/WishlistPanel.jsx'
import RentalCartDock from '../components/RentalCartDock.jsx'

import RentalCheckoutDialog from '../../rentals/components/RentalCheckoutDialog.jsx'

import { DeliveryWorkspace } from '../../maps/components/DeliveryWorkspace.jsx'
import CustomerRentals from '../../rentals/pages/CustomerRentals.jsx'
import CustomerVerification from '../../identity/pages/CustomerVerification.jsx'
import AddressManager from '../../identity/pages/AddressManager.jsx'
import NotificationCenter from '../../notifications/pages/NotificationCenter.jsx'
import { IdentityStatusCard } from '../../identity/components/IdentityStatusCard.jsx'

import { BrandMark } from '../../../components/ui/BrandMark.jsx'

import '../styles/marketplace.css'

import AccountSettingsDialog from '../components/AccountSettingsDialog.jsx'

import ProductDetailsContent from '../../products/components/ProductDetailsContent.jsx'

function CustomerPage({ user, token, onLogout, onAccountUpdate }) {
  const {
    products,
    productsLoading,
    wishlist,
    requests,
    setRequests,
    setNotifications,
    address,
    savedAddress,
    loyaltyPoints,
    identityProfile,
    setIdentityProfile,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    endDateInput,
    billingUnit,
    cart,
    setCart,
    search,
    setSearch,
    category,
    setCategory,
    setAppliedCategory,
    deliveryMethod,
    setDeliveryMethod,
    mapsConfigured,
    feeQuote,
    quoteLoading,
    quoteError,
    deliverySelection,
    setDeliverySelection,
    couponInput,
    setCouponInput,
    appliedCoupon,
    setAppliedCoupon,
    couponMessage,
    setCouponMessage,
    panel,
    setPanel,
    message,
    error,
    busy,
    signingOut,
    selectedProduct,
    setSelectedProduct,
    productReviews,
    reviewsLoading,
    animateSignOut,
    api,
    accountSettings,
    profileMenuOpen,
    setProfileMenuOpen,
    openProfileSettings,
    load,
    returnToBrowse,
    openVerification,
    openAddresses,
    refreshProfile,
    addToRequest,
    unread,
    categories,
    searchSuggestions,
    visible,
    cartProducts,
    hours,
    days,
    durationLabel,
    subtotal,
    profileReady,
    checkout,
    toggleWishlist,
    openProductDetails,
    handleProductCardKey,
    applyCoupon,
    calculateDelivery,
    openInbox,
    changeBillingUnit,
    today,
  } = useMarketplace({ user, token, onLogout, onAccountUpdate })
  return (
    <main className="marketplace">
      <CustomerNavigation
        animateSignOut={animateSignOut}
        loyaltyPoints={loyaltyPoints}
        openInbox={openInbox}
        openProfileSettings={openProfileSettings}
        panel={panel}
        profileMenuOpen={profileMenuOpen}
        returnToBrowse={returnToBrowse}
        setPanel={setPanel}
        setProfileMenuOpen={setProfileMenuOpen}
        unread={unread}
        user={user}
      />

      <div className="market-content re-content-transition">
        {panel === 'browse' && (
          <RentalCatalog
            addToRequest={addToRequest}
            api={api}
            billingUnit={billingUnit}
            cart={cart}
            categories={categories}
            category={category}
            changeBillingUnit={changeBillingUnit}
            days={days}
            deliveryMethod={deliveryMethod}
            endDate={endDate}
            endDateInput={endDateInput}
            error={error}
            handleProductCardKey={handleProductCardKey}
            identityProfile={identityProfile}
            load={load}
            message={message}
            openAddresses={openAddresses}
            openProductDetails={openProductDetails}
            openVerification={openVerification}
            productsLoading={productsLoading}
            search={search}
            searchSuggestions={searchSuggestions}
            setAppliedCategory={setAppliedCategory}
            setCart={setCart}
            setCategory={setCategory}
            setDeliveryMethod={setDeliveryMethod}
            setEndDate={setEndDate}
            setSearch={setSearch}
            setStartDate={setStartDate}
            startDate={startDate}
            today={today}
            toggleWishlist={toggleWishlist}
            visible={visible}
            wishlist={wishlist}
          />
        )}

        {panel === 'wishlist' && (
          <WishlistPanel
            handleProductCardKey={handleProductCardKey}
            openProductDetails={openProductDetails}
            toggleWishlist={toggleWishlist}
            wishlist={wishlist}
          />
        )}

        {panel === 'verification' && (
          <CustomerVerification
            api={api}
            token={token}
            onBack={returnToBrowse}
            onUpdate={setIdentityProfile}
          />
        )}
        {panel === 'addresses' && (
          <AddressManager api={api} onBack={returnToBrowse} onUpdate={refreshProfile} />
        )}
        {panel === 'requests' && (
          <CustomerRentals
            initialRentals={requests}
            products={products}
            user={user}
            token={token}
            api={api}
            onRentalsChange={setRequests}
            onBrowse={returnToBrowse}
            onMessages={openInbox}
          />
        )}
        {panel === 'requests' && <DeliveryTaskBoard api={api} role="user" />}
        {panel === 'requests' && <DeliveryWorkspace api={api} role="user" />}
        {panel === 'requests' && (
          <IdentityStatusCard
            identity={identityProfile}
            onOpen={openVerification}
            onAddresses={openAddresses}
          />
        )}
        {panel === 'inbox' && (
          <NotificationCenter
            api={api}
            onChange={setNotifications}
            onNavigate={(target) =>
              setPanel(
                ['verification', 'addresses', 'requests'].includes(target) ? target : 'inbox',
              )
            }
          />
        )}
      </div>

      {cartProducts.length > 0 && (
        <RentalCartDock cartProducts={cartProducts} days={days} subtotal={subtotal} />
      )}
      <AccountSettingsDialog
        settings={accountSettings}
        user={user}
        identityProfile={identityProfile}
        savedAddress={savedAddress}
        openVerification={openVerification}
        openAddresses={openAddresses}
        busy={busy}
      />
      <RentalCheckoutDialog
        address={address}
        appliedCoupon={appliedCoupon}
        applyCoupon={applyCoupon}
        billingUnit={billingUnit}
        busy={busy}
        calculateDelivery={calculateDelivery}
        cartProducts={cartProducts}
        checkout={checkout}
        couponInput={couponInput}
        couponMessage={couponMessage}
        days={days}
        deliveryMethod={deliveryMethod}
        deliverySelection={deliverySelection}
        durationLabel={durationLabel}
        endDate={endDate}
        error={error}
        feeQuote={feeQuote}
        hours={hours}
        identityProfile={identityProfile}
        mapsConfigured={mapsConfigured}
        openProfileSettings={openProfileSettings}
        openVerification={openVerification}
        profileReady={profileReady}
        savedAddress={savedAddress}
        setAppliedCoupon={setAppliedCoupon}
        setCouponInput={setCouponInput}
        setCouponMessage={setCouponMessage}
        setDeliveryMethod={setDeliveryMethod}
        setDeliverySelection={setDeliverySelection}
        quoteLoading={quoteLoading}
        quoteError={quoteError}
        setStartDate={setStartDate}
        setEndDate={setEndDate}
        startDate={startDate}
        subtotal={subtotal}
        today={today}
      />
      <dialog
        className="product-detail-dialog"
        id="product-details"
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
            <button
              type="button"
              className="checkout-submit product-detail-add"
              disabled={
                productsLoading ||
                selectedProduct.availabilityStatus === 'on_rental' ||
                (Boolean(days) && !selectedProduct.available) ||
                cart.includes(selectedProduct._id)
              }
              onClick={() => {
                addToRequest(selectedProduct)
                document.getElementById('product-details')?.close()
              }}
            >
              {cart.includes(selectedProduct._id)
                ? 'Added to request'
                : selectedProduct.availabilityStatus === 'on_rental'
                  ? 'Currently on rental'
                  : !days
                    ? 'Choose rental dates'
                    : selectedProduct.available
                      ? 'Add to rental request'
                      : 'Booked for these dates'}
            </button>
          </ProductDetailsContent>
        )}
      </dialog>
      <footer className="market-footer">
        <a className="market-footer-brand" href="/">
          <BrandMark className="market-logo" />
          RentEase
        </a>
        <p>Useful things, shared by your community.</p>
        <small>© {new Date().getFullYear()} RentEase</small>
      </footer>
      {signingOut && (
        <div className="signout-scene re-signout" role="status" aria-label="Signing out">
          <div className="re-signout-card">
            <BrandMark />
            <div>
              <strong>See you soon.</strong>
              <p>Signing you out...</p>
            </div>
            <span className="register-spinner" aria-hidden="true" />
          </div>
        </div>
      )}
    </main>
  )
}

export default CustomerPage
