import { useDeliveryRefresh } from '../../delivery-partner/hooks/useDeliveryEvents.js'
import useDeliveryQuote from '../../maps/hooks/useDeliveryQuote.js'
import { rentalPrice } from '../../rentals/utils/rentalPricing.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addressText } from '../../identity/utils/address.js'
import { defaultRentalDates, validRentalDates } from '../../rentals/utils/rentalAvailability.js'
import { formatCurrency as money } from '../../../utils/currency.js'
import useAccountSettings from './useAccountSettings.js'
import { createApiClient } from '../../../services/http.js'

const initialDates = defaultRentalDates()
const today = initialDates.startDate

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
  const [identityProfile, setIdentityProfile] = useState(null)
  const [startDate, setStartDate] = useState(today)
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
  const [panel, setPanel] = useState('browse')

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [productReviews, setProductReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(false)

  const animateSignOut = () => {
    if (signingOut) return
    setSigningOut(true)
    window.setTimeout(() => onLogout(), 1450)
  }

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
        const [catalog, orders, inbox, saved, identity] = await Promise.all([
          api(
            validRentalDates(startDate, endDate)
              ? `/api/products?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
              : '/api/products',
          ),
          catalogOnly ? null : api('/api/requests'),
          catalogOnly ? null : api('/api/inbox'),
          catalogOnly ? null : api('/api/wishlist'),
          catalogOnly ? null : api('/api/identity/status'),
        ])
        if (sequence !== catalogSequence.current) return
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
          setMapsConfigured(catalog.mapsConfigured)
          setRequests(orders.requests || [])
          setNotifications(inbox.notifications || [])
          setWishlist(saved.products || [])
          setIdentityProfile(identity)
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
  }, [load])
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
  const addToRequest = (product) => {
    if (!validRentalDates(startDate, endDate)) {
      setMessage(
        'Choose a return date after the start date to check availability and add this item.',
      )
      endDateInput.current?.focus()
      return
    }
    if (identityProfile?.eligible !== true) {
      openVerification()
      return
    }
    if (productsLoading || !product.available) return
    setCart((current) => (current.includes(product._id) ? current : [...current, product._id]))
  }

  useEffect(() => {
    if (user.role !== 'user') return
    const poll = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const [identity, inbox] = await Promise.all([
          api('/api/identity/status'),
          api('/api/inbox'),
        ])
        setIdentityProfile(identity)
        setNotifications(inbox.notifications || [])
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
  const hours =
    endDate && new Date(endDate) > new Date(startDate)
      ? Math.ceil((new Date(endDate) - new Date(startDate)) / 3600000)
      : 0
  const days = hours ? Math.ceil(hours / 24) : 0
  const durationLabel = billingUnit === 'hour' ? `${hours} hours` : `${days} days`
  const subtotal = cartProducts.reduce(
    (sum, item) => sum + rentalPrice(item, days, billingUnit === 'hour' ? hours : null),
    0,
  )
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
          startDate,
          endDate,
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
        }),
      })
      document.getElementById('rental-checkout')?.close()
      setCart([])

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
  const toggleWishlist = async (product) => {
    setError('')
    try {
      if (wishlist.some((saved) => saved._id === product._id)) {
        await api(`/api/wishlist/${product._id}`, { method: 'DELETE' })
        setWishlist((items) => items.filter((item) => item._id !== product._id))
      } else {
        await api(`/api/wishlist/${product._id}`, { method: 'PUT' })
        setWishlist((items) => [...items, product])
      }
    } catch (wishlistError) {
      setError(wishlistError.message)
    }
  }
  const openProductDetails = async (product) => {
    setSelectedProduct(products.find((entry) => entry._id === product._id) || product)
    setProductReviews([])
    setReviewsLoading(true)
    document.getElementById('product-details')?.showModal()
    try {
      const result = await api(`/api/reviews/product/${product._id}`)
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
  }
}
