import { useDeliveryRefresh } from '../../delivery-partner/hooks/useDeliveryEvents.js'
import useDeliveryQuote from '../../maps/hooks/useDeliveryQuote.js'
import { rentalPrice } from '../../rentals/utils/rentalPricing.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addressText } from '../../identity/utils/address.js'
import { defaultRentalDates, toServerDate, validRentalDates } from '../../rentals/utils/rentalAvailability.js'
import { formatCurrency as money } from '../../../utils/currency.js'
import useAccountSettings from './useAccountSettings.js'
import { createApiClient } from '../../../services/http.js'
import useProductRoute from '../../products/hooks/useProductRoute.js'
import { emptyLoyalty, loyaltyRewardAmount } from '../../loyalty/utils/loyalty.js'
import { providerOf, shopNameOf } from '../../rentals/utils/rentalShop.js'

const initialDates = defaultRentalDates()
// Customer pages live in ?view= so Back, Forward and refresh keep the customer where they were.
const VIEWS = new Set(['browse', 'requests', 'wishlist', 'rewards', 'messages', 'inbox', 'addresses', 'verification'])
const viewFromUrl = () => {
  const view = new URLSearchParams(window.location.search).get('view')
  return VIEWS.has(view) ? view : 'browse'
}

export default function useMarketplace({ user, token, onLogout, onAccountUpdate }) {
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [wishlist, setWishlist] = useState([])
  const [requests, setRequests] = useState([])
  const [notifications, setNotifications] = useState([])
  const [address, setAddress] = useState('')
  const [savedAddress, setSavedAddress] = useState('')
  const [, setNic] = useState('')
  const [savedNic, setSavedNic] = useState('')
  const [loyaltyPoints, setLoyaltyPoints] = useState(0)
  const [loyalty, setLoyalty] = useState(emptyLoyalty)
  // The cart item a loyalty level reward (2% off) is applied to, if any.
  const [rewardChoice, setRewardChoice] = useState('')
  // An item from another shop the customer tried to add: { product, currentShop, nextShop }.
  const [cartConflict, setCartConflict] = useState(null)
  const [identityProfile, setIdentityProfile] = useState(null)
  const [startDate, setStartDate] = useState(initialDates.startDate)
  const [endDate, setEndDate] = useState(initialDates.endDate)
  const catalogSequence = useRef(0)
  const endDateInput = useRef(null)
  const [billingUnit, setBillingUnit] = useState('day')
  const [cart, setCart] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [appliedCategory, setAppliedCategory] = useState('all')
  const [deliveryMethod, setDeliveryMethod] = useState('')
  const [mapsConfigured, setMapsConfigured] = useState(true)
  const [deliverySelection, setDeliverySelection] = useState({})
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState(null)
  const [couponMessage, setCouponMessage] = useState('')
  const [panel, setPanelState] = useState(viewFromUrl)
  const setPanel = useCallback((next) => {
    setPanelState(next)
    const url = next === 'browse' ? window.location.pathname : `${window.location.pathname}?view=${next}`
    if (url !== window.location.pathname + window.location.search) window.history.pushState({ view: next }, '', url)
  }, [])
  useEffect(() => {
    const onPopState = () => setPanelState(viewFromUrl())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)

  const animateSignOut = () => {
    if (signingOut) return
    setSigningOut(true)
    window.setTimeout(() => onLogout(), 1450)
  }

  // Recomputed each render so a tab left open past midnight never offers yesterday.
  const today = defaultRentalDates().startDate
  const wishlistPending = useRef(new Set())
  const api = useMemo(() => createApiClient(token), [token])
  const accountSettings = useAccountSettings({
    user,
    api,
    savedAddress,
    setBusy,
    onAccountUpdate,
    onProfileSaved: (result) => {
      setNic(result.nic)
      setSavedNic(result.nic)
      setAddress(result.address)
      setSavedAddress(result.address)
      setMapsConfigured(result.mapsConfigured)
    },
    onRestoreContact: () => {
      setNic(savedNic)
      setAddress(savedAddress)
    },
  })
  const { profileMenuOpen, setProfileMenuOpen, openProfileSettings } = accountSettings

  const load = useCallback(
    async ({ catalogOnly = false, silent = false } = {}) => {
      const sequence = ++catalogSequence.current
      if (!silent) setProductsLoading(true)
      try {
        const results = await Promise.allSettled([
          api(
            validRentalDates(startDate, endDate)
              ? `/api/products?startDate=${encodeURIComponent(toServerDate(startDate))}&endDate=${encodeURIComponent(toServerDate(endDate))}`
              : '/api/products',
          ),
          catalogOnly ? null : api('/api/requests'),
          catalogOnly ? null : api('/api/inbox'),
          catalogOnly ? null : api('/api/wishlist'),
          catalogOnly ? null : api('/api/identity/status'),
        ])
        const [catalog, orders, inbox, saved, identity] = results.map((result) => result.status === 'fulfilled' ? result.value : null)
        if (sequence !== catalogSequence.current) return
        if (!catalog) throw results[0].reason
        setProducts(catalog.products || [])
        setSelectedProduct((current) =>
          current ? catalog.products?.find((product) => product._id === current._id) || null : null,
        )
        setCart((current) =>
          current.filter((id) =>
            catalog.products?.some((product) => product._id === id && product.available),
          ),
        )
        setError('')
        if (!catalogOnly) {
          setAddress(catalog.address || '')
          setSavedAddress(catalog.address || '')
          setNic(catalog.nic || '')
          setSavedNic(catalog.nic || '')
          setLoyaltyPoints(catalog.loyaltyPoints || 0)
          if (catalog.loyalty) setLoyalty(catalog.loyalty)
          setMapsConfigured(catalog.mapsConfigured)
          if (orders) setRequests(orders.requests || [])
          if (inbox) setNotifications(inbox.notifications || [])
          if (saved) setWishlist(saved.products || [])
          if (identity) setIdentityProfile(identity)
        }
      } catch (loadError) {
        if (sequence === catalogSequence.current) setError(loadError.message)
      } finally {
        if (sequence === catalogSequence.current) setProductsLoading(false)
      }
    },
    [api, startDate, endDate],
  )

  useEffect(() => {
    if (user.role !== 'user') return
    load()
    return () => {
      catalogSequence.current += 1
    }
  }, [load, user.role])
  useEffect(() => {
    if (panel !== 'browse' || user.role !== 'user') return
    const refresh = () => {
      if (document.visibilityState !== 'hidden') load({ catalogOnly: true, silent: true })
    }
    const timer = setInterval(refresh, 20_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [panel, load, user.role])
  const returnToBrowse = useCallback(() => {
    setPanel('browse')
    load({ catalogOnly: true })
  }, [load, setPanel])
  const openVerification = () => {
    document.getElementById('profile-settings')?.close()
    document.getElementById('rental-checkout')?.close()
    setPanel('verification')
  }
  const openAddresses = () => {
    document.getElementById('profile-settings')?.close()
    document.getElementById('rental-checkout')?.close()
    setPanel('addresses')
  }
  const refreshProfile = useCallback(async () => {
    const result = await api('/api/identity/status')
    setIdentityProfile(result)
    setAddress(addressText(result.defaultAddress))
    setSavedAddress(addressText(result.defaultAddress))
  }, [api])
  const addToRequest = (product, { withReward = false } = {}) => {
    if (!validRentalDates(startDate, endDate)) {
      setMessage(
        'Choose a return date after the start date to check availability and add this item.',
      )
      endDateInput.current?.focus()
      return false
    }
    if (identityProfile?.eligible !== true) {
      setMessage(identityProfile?.status === 'pending'
        ? 'Your NIC verification is pending. You can keep browsing while an administrator reviews it.'
        : ['rejected', 'resubmission_required'].includes(identityProfile?.status)
          ? 'Your NIC verification needs attention. Review the feedback and resubmit before requesting a rental.'
          : 'Verify your NIC and residential address before requesting a rental. You can continue exploring all products.')
      document.getElementById('rental-verification-notice')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      return false
    }
    if (productsLoading || !product.available) return false
    // One request = one shop, so everything is picked up together or brought by one rider.
    const inCart = products.find((entry) => cart.includes(entry._id) && entry._id !== product._id)
    if (inCart && providerOf(inCart) !== providerOf(product)) {
      setCartConflict({ product, currentShop: shopNameOf(inCart), nextShop: shopNameOf(product), withReward })
      return 'conflict'
    }
    setCart((current) => (current.includes(product._id) ? current : [...current, product._id]))
    return true
  }
  // Rewards page: put the item in the request with the 2% level reward on it.
  const redeemReward = (product) => {
    if (loyalty.rewardsAvailable < 1) return false
    const added = addToRequest(product, { withReward: true })
    if (added === true) setRewardChoice(product._id)
    return added
  }
  // "Start a new request": the other shop's item replaces the current cart.
  const startRequestWith = () => {
    if (!cartConflict) return
    setCart([cartConflict.product._id])
    setRewardChoice(cartConflict.withReward ? cartConflict.product._id : '')
    setAppliedCoupon(null)
    setMessage(`Started a new request from ${cartConflict.nextShop}.`)
    setCartConflict(null)
  }

  useEffect(() => {
    if (user.role !== 'user') return
    const poll = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const [identity, inbox] = await Promise.allSettled([
          api('/api/identity/status'),
          api('/api/inbox'),
        ])
        if (identity.status === 'fulfilled') setIdentityProfile(identity.value)
        if (inbox.status === 'fulfilled') setNotifications(inbox.value.notifications || [])
      } catch {
        /* Existing notices remain visible during a transient refresh failure. */
      }
    }
    const timer = setInterval(poll, 20000)
    window.addEventListener('focus', poll)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', poll)
    }
  }, [api, user.role])

  const unread = notifications.filter((item) => !item.readAt).length
  const categories = useMemo(
    () => [...new Set(products.map((item) => item.category))].sort(),
    [products],
  )
  const searchSuggestions = useMemo(() => {
    const normalize = (text) =>
      String(text || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
    const query = normalize(search).trim()
    if (!query) return []
    return [...new Set([...categories, ...products.map((item) => item.title).filter(Boolean)])]
      .filter((suggestion) => normalize(suggestion).includes(query))
      .sort(
        (a, b) =>
          Number(normalize(b).startsWith(query)) - Number(normalize(a).startsWith(query)) ||
          a.localeCompare(b),
      )
      .slice(0, 8)
  }, [products, categories, search])
  const visible = useMemo(() => {
    const normalize = (text) =>
      String(text || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
    const terms = normalize(search).trim().split(/\s+/).filter(Boolean)
    const matches = (item) => {
      const searchable = normalize(
        `${item.title} ${item.category} ${item.description} ${item.location}`,
      )
      return (
        terms.every((term) => searchable.includes(term)) &&
        (appliedCategory === 'all' || item.category === appliedCategory)
      )
    }
    return products.filter(matches)
  }, [products, search, appliedCategory])
  const cartProducts = cart
    .map((id) => products.find((product) => product._id === id))
    .filter(Boolean)
  // Every cart item comes from this shop; items from other shops need a separate request.
  const cartShop = cartProducts[0]
    ? { id: providerOf(cartProducts[0]), name: shopNameOf(cartProducts[0]) }
    : null
  const hours =
    endDate && new Date(endDate) > new Date(startDate)
      ? Math.ceil((new Date(endDate) - new Date(startDate)) / 3600000)
      : 0
  const days = hours ? Math.ceil(hours / 24) : 0
  const durationLabel =
    billingUnit === 'hour' ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : `${days} ${days === 1 ? 'day' : 'days'}`
  // The reward only counts while one is available and its item is still in the cart.
  const rewardProductId =
    loyalty.rewardsAvailable > 0 && cart.includes(rewardChoice) ? rewardChoice : ''
  const fullPrice = (item) => rentalPrice(item, days, billingUnit === 'hour' ? hours : null)
  const loyaltyDiscount = rewardProductId
    ? loyaltyRewardAmount(fullPrice(cartProducts.find((item) => item._id === rewardProductId)))
    : 0
  const subtotal =
    cartProducts.reduce((sum, item) => sum + fullPrice(item), 0) - loyaltyDiscount
  const profileReady = identityProfile?.eligible === true
  const selectedAddress =
    identityProfile?.addresses?.find((entry) => entry._id === deliverySelection.addressId) ||
    identityProfile?.defaultAddress
  const {
    feeQuote,
    quoteLoading,
    quoteError,
    recalculateDelivery: calculateDelivery,
  } = useDeliveryQuote({
    api,
    enabled: deliveryMethod === 'partner' && profileReady,
    productIds: cart,
    selection: deliverySelection,
    defaultAddress: selectedAddress,
    startDate,
    endDate,
    billingUnit,
    couponCode: appliedCoupon?.subtotal === subtotal ? appliedCoupon.code : '',
    loyaltyRewardProductId: rewardProductId,
    pricingContext: cartProducts.map((item) => [
      item._id,
      rentalPrice(item, days, billingUnit === 'hour' ? hours : null),
      item.depositAmount,
    ]),
  })

  const checkout = async () => {
    if (!['pickup', 'partner'].includes(deliveryMethod)) {
      setError('Choose Self Pickup or Delivery Partner before confirming your rental.')
      return
    }
    if (deliveryMethod === 'partner' && (!feeQuote || quoteLoading)) return
    setError('')
    setMessage('')
    setBusy(true)
    try {
      const result = await api('/api/requests', {
        method: 'POST',
        body: JSON.stringify({
          productIds: cart,
          startDate: toServerDate(startDate),
          endDate: toServerDate(endDate),
          billingUnit,
          deliveryMethod,
          address: deliveryMethod === 'partner' ? feeQuote?.destination.address : savedAddress,
          ...deliverySelection,
          quoteToken: feeQuote?.quoteToken,
          expectedTotal:
            deliveryMethod === 'partner' && feeQuote?.pricing
              ? feeQuote.pricing.total
              : subtotal -
                (appliedCoupon?.subtotal === subtotal ? appliedCoupon.discountAmount : 0) +
                (deliveryMethod === 'partner'
                  ? (feeQuote?.deliveryFee || 0) + (feeQuote?.returnCollectionFee || 0)
                  : 0),
          couponCode: appliedCoupon?.subtotal === subtotal ? appliedCoupon.code : '',
          loyaltyRewardProductId: rewardProductId,
        }),
      })
      document.getElementById('rental-checkout')?.close()
      setCart([])
      setRewardChoice('')

      setPanel('requests')
      setMessage(result.message)
      await load()
    } catch (checkoutError) {
      setError(checkoutError.message)
      if (deliveryMethod === 'partner' && checkoutError.status === 409) calculateDelivery()
      if (checkoutError.code?.startsWith('IDENTITY_')) openVerification()
    } finally {
      setBusy(false)
    }
  }
  const removeFromCart = (productId) => setCart((current) => current.filter((id) => id !== productId))
  const clearCart = () => {
    setCart([])
    setRewardChoice('')
    setAppliedCoupon(null)
    document.getElementById('rental-checkout')?.close()
  }
  const toggleWishlist = async (product) => {
    // Ignore repeat clicks while this product's request is in flight.
    if (wishlistPending.current.has(product._id)) return
    wishlistPending.current.add(product._id)
    setError('')
    try {
      if (wishlist.some((saved) => saved._id === product._id)) {
        await api(`/api/wishlist/${product._id}`, { method: 'DELETE' })
        setWishlist((items) => items.filter((item) => item._id !== product._id))
      } else {
        await api(`/api/wishlist/${product._id}`, { method: 'PUT' })
        setWishlist((items) => (items.some((item) => item._id === product._id) ? items : [...items, product]))
      }
    } catch (wishlistError) {
      setError(wishlistError.message)
    } finally {
      wishlistPending.current.delete(product._id)
    }
  }
  const showProductDetails = (product) => {
    setSelectedProduct(products.find((entry) => entry._id === product._id) || product)
  }
  const { open: openProductDetails, close: closeProductDetails } = useProductRoute({
    products,
    selectedId: selectedProduct?._id,
    show: showProductDetails,
    hide: () => setSelectedProduct(null),
  })
  const handleProductCardKey = (event, product) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
      event.preventDefault()
      openProductDetails(product)
    }
  }
  const applyCoupon = async () => {
    setCouponMessage('')
    try {
      const result = await api('/api/coupons/validate', {
        method: 'POST',
        body: JSON.stringify({ code: couponInput, subtotal }),
      })
      setAppliedCoupon({ code: result.code, discountAmount: result.discountAmount, subtotal })
      setCouponMessage(`${result.code} applied. You save ${money(result.discountAmount)}.`)
    } catch (couponError) {
      setAppliedCoupon(null)
      setCouponMessage(couponError.message)
    }
  }
  const openInbox = () => setPanel('inbox')

  const changeBillingUnit = (unit) => {
    setBillingUnit(unit)
    setStartDate((value) =>
      value ? (unit === 'hour' ? `${value.slice(0, 10)}T09:00` : value.slice(0, 10)) : '',
    )
    setEndDate((value) =>
      value ? (unit === 'hour' ? `${value.slice(0, 10)}T17:00` : value.slice(0, 10)) : '',
    )
    setCart([])
  }

  const refreshDelivery = useCallback(() => load({ silent: true }), [load])
  useDeliveryRefresh(refreshDelivery)

  return {
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
    removeFromCart,
    clearCart,
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
  }
}
