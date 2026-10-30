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

import ProductPage from '../../products/pages/ProductPage.jsx'
import LoyaltyPanel from '../../loyalty/components/LoyaltyPanel.jsx'
import CartShopDialog from '../components/CartShopDialog.jsx'
import { providerOf, shopNameOf } from '../../rentals/utils/rentalShop.js'
import { useState } from 'react'
import SiteFooter from '../../../components/layout/SiteFooter.jsx'
import ChatScreen from '../../chat/components/ChatScreen.jsx'
import useConversations from '../../chat/hooks/useConversations.js'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'

function CustomerPage({ user, token, onLogout, onAccountUpdate }) {
  const [notificationRentalId, setNotificationRentalId] = useState(null)
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
    loyalty,
    rewardProductId,
    setRewardChoice,
    redeemReward,
    loyaltyDiscount,
    cartShop,
    cartConflict,
    setCartConflict,
    startRequestWith,
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
    removeFromCart,
    clearCart,
    hours,
    days,
    durationLabel,
    subtotal,
    profileReady,
    checkout,
    toggleWishlist,
    openProductDetails,
    closeProductDetails,
    handleProductCardKey,
    applyCoupon,
    calculateDelivery,
    openInbox,
    changeBillingUnit,
    today,
  } = useMarketplace({ user, token, onLogout, onAccountUpdate })
  const chats = useConversations(api)
  // target is { productId } from a listing or { requestId } from a rental. The product page is
  // hidden directly (not via history.back) so Back from Messages returns to it.
  const messageShop = (target) => {
    setSelectedProduct(null)
    setPanel('messages')
    chats.startChat(target)
  }
  const openNotification = (target, row) => {
    if (row?.requestId) setNotificationRentalId(String(row.requestId))
    setPanel(['verification', 'addresses', 'requests'].includes(target) ? target : row?.deliveryTaskId ? 'requests' : 'inbox')
  }
  return (
    <>
    <main className="marketplace">
      <CustomerNavigation
        animateSignOut={animateSignOut}
        loyaltyPoints={loyaltyPoints}
        loyalty={loyalty}
        openInbox={openInbox}
        openProfileSettings={openProfileSettings}
        panel={panel}
        profileMenuOpen={profileMenuOpen}
        returnToBrowse={returnToBrowse}
        setPanel={setPanel}
        setProfileMenuOpen={setProfileMenuOpen}
        unread={unread}
        user={user}
        api={api}
        onNotification={openNotification}
        chatUnread={chats.unread}
      />

      <div className="market-content re-content-transition">
        {panel === 'browse' && (
          <RentalCatalog
            addToRequest={addToRequest}
            removeFromCart={removeFromCart}
            api={api}
            billingUnit={billingUnit}
            cart={cart}
            cartShop={cartShop}
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

        {panel === 'rewards' && (
          <LoyaltyPanel
            api={api}
            user={user}
            loyalty={loyalty}
            products={products}
            cart={cart}
            days={days}
            hours={hours}
            billingUnit={billingUnit}
            rewardProductId={rewardProductId}
            redeemReward={redeemReward}
            setRewardChoice={setRewardChoice}
            openProductDetails={openProductDetails}
            onBrowse={returnToBrowse}
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
            onChat={(rental) => messageShop({ requestId: rental._id })}
            focusRentalId={notificationRentalId}
            onFocusConsumed={() => setNotificationRentalId(null)}
          />
        )}
        {panel === 'requests' && <DeliveryTaskBoard api={api} role="user" hideWhenEmpty />}
        {panel === 'requests' && <DeliveryWorkspace api={api} role="user" hideWhenEmpty />}
        {panel === 'requests' && identityProfile && identityProfile.eligible !== true && (
          <IdentityStatusCard
            identity={identityProfile}
            onOpen={openVerification}
            onAddresses={openAddresses}
          />
        )}
        {panel === 'messages' && <ChatScreen api={api} chats={chats} onBack={returnToBrowse} />}
        {panel === 'inbox' && (
          <NotificationCenter
            api={api}
            onChange={setNotifications}
            onNavigate={openNotification}
          />
        )}
      </div>

      {cartProducts.length > 0 && (
        <RentalCartDock cartProducts={cartProducts} cartShop={cartShop} days={days} subtotal={subtotal} onClear={clearCart} />
      )}
      {cartConflict && (
        <CartShopDialog
          conflict={cartConflict}
          onKeep={() => setCartConflict(null)}
          onStartNew={startRequestWith}
        />
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
        removeFromCart={removeFromCart}
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
        loyalty={loyalty}
        rewardProductId={rewardProductId}
        setRewardChoice={setRewardChoice}
        loyaltyDiscount={loyaltyDiscount}
        cartShop={cartShop}
      />
      {selectedProduct && (
        <ProductPage
          product={selectedProduct}
          onBack={closeProductDetails}
        >
          {cart.includes(selectedProduct._id) ? (
            <button
              type="button"
              className="checkout-submit product-detail-add product-detail-remove"
              onClick={() => removeFromCart(selectedProduct._id)}
            >
              ✓ Added · Remove from request
            </button>
          ) : (
            <button
              type="button"
              className="checkout-submit product-detail-add"
              disabled={
                productsLoading ||
                selectedProduct.availabilityStatus === 'on_rental' ||
                (Boolean(days) && !selectedProduct.available)
              }
              onClick={() => {
                addToRequest(selectedProduct)
                closeProductDetails()
              }}
            >
              {selectedProduct.availabilityStatus === 'on_rental'
                ? 'Currently on rental'
                : !days
                  ? 'Choose rental dates'
                  : !selectedProduct.available
                    ? 'Booked for these dates'
                    : cartShop && cartShop.id !== providerOf(selectedProduct)
                      ? `From ${shopNameOf(selectedProduct)} · start a new request`
                      : 'Add to rental request'}
            </button>
          )}
          <p className="product-shop-rule">
            One request = one shop. Items from {shopNameOf(selectedProduct)} are picked up together or
            delivered by one rider.
          </p>
          {/* Listings RentEase runs itself have no shop name and no shop to message. */}
          {selectedProduct.providerId?.shopName && (
            <button
              type="button"
              className="product-message-shop"
              onClick={() => messageShop({ productId: selectedProduct._id })}
            >
              <UiIcon name="chat" size={18} />
              Message {shopNameOf(selectedProduct)}
            </button>
          )}
        </ProductPage>
      )}
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
    <SiteFooter authenticated onNavigate={(view) => { setPanel(view); window.scrollTo({ top: 0, behavior: 'instant' }) }} onBrowse={() => { returnToBrowse(); window.scrollTo({ top: 0, behavior: 'instant' }) }} />
    </>
  )
}

export default CustomerPage
