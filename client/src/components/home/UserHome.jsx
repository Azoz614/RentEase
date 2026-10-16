import { useCallback, useEffect, useMemo, useState } from 'react'
import OwnerHome from './OwnerHome.jsx'
import DeliveryHome from './DeliveryHome.jsx'
import { readJsonResponse } from '../../utils/readJsonResponse.js'
import './user-home.css'

const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const money = (amount) => `LKR ${Number(amount || 0).toLocaleString('en-LK')}`
const rentalPrice = (product, dayCount, hourCount = null) => {
  const daily = Number(product.dailyRate || 0)
  if (hourCount !== null) return product.hourlyRate ? hourCount * Number(product.hourlyRate) : dayCount * daily
  const weeks = Math.floor(dayCount / 7), remainder = dayCount % 7
  const weekly = Number(product.weeklyRate || daily * 7)
  const base = dayCount >= 7 ? weeks * weekly + remainder * daily : dayCount * daily
  return Math.round(base * (1 - Number(product.longRentalDiscountPercent || 0) / 100))
}
const requestStatus = (request) => {
  const decisions = request.items.map((item) => item.decision)
  if (decisions.every((value) => value === 'accepted')) return 'Accepted'
  if (decisions.every((value) => value === 'rejected')) return 'Declined'
  if (decisions.every((value) => value !== 'pending')) return 'Partially accepted'
  return decisions.some((value) => value === 'accepted') ? 'Partially reviewed' : 'Awaiting provider'
}

const readImageData = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

function Icon({ name }) {
  const shared = { width: 19, height: 19, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  if (name === 'mail') return <svg {...shared}><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></svg>
  if (name === 'rent') return <svg {...shared}><path d="M4 7h16l-1.4 13H5.4L4 7Z" /><path d="M9 9V6a3 3 0 0 1 6 0v3" /><path d="M8 12h8" /></svg>
  if (name === 'wishlist') return <svg {...shared}><path d="M20.8 8.7c0 5.2-8.8 10.2-8.8 10.2S3.2 13.9 3.2 8.7A4.2 4.2 0 0 1 12 6.4a4.2 4.2 0 0 1 8.8 2.3Z" /></svg>
  if (name === 'profile') return <svg {...shared}><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>
  if (name === 'contact') return <svg {...shared}><rect x="4" y="3" width="16" height="18" rx="2" /><circle cx="12" cy="9" r="2.5" /><path d="M8 16h8" /></svg>
  if (name === 'security') return <svg {...shared}><path d="M12 3 19 6v5c0 4.5-3 7.8-7 10-4-2.2-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
  if (name === 'edit') return <svg {...shared}><path d="m14 5 5 5" /><path d="M4 20l4.2-.8L19 8.4 15.6 5 4.8 15.8 4 20Z" /><path d="M13 20h7" /></svg>
  if (name === 'settings') return <svg {...shared}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.8Z" transform="translate(-1 -1) scale(.98)" /></svg>
  return <svg {...shared}><path d="m8 10 4 4 4-4" /></svg>
}

function UserHome({ user, token, onLogout, onAccountUpdate }) {
  const [products, setProducts] = useState([])
  const [productsLoading, setProductsLoading] = useState(true)
  const [wishlist, setWishlist] = useState([])
  const [requests, setRequests] = useState([])
  const [notifications, setNotifications] = useState([])
  const [address, setAddress] = useState('')
  const [savedAddress, setSavedAddress] = useState('')
  const [nic, setNic] = useState('')
  const [savedNic, setSavedNic] = useState('')
  const [loyaltyPoints, setLoyaltyPoints] = useState(0)
  const [identityStatus, setIdentityStatus] = useState('not_submitted')
  const [identityFront, setIdentityFront] = useState('')
  const [identityBack, setIdentityBack] = useState('')
  const [identityMessage, setIdentityMessage] = useState('')
  const [identityError, setIdentityError] = useState('')
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState('')
  const [billingUnit, setBillingUnit] = useState('day')
  const [cart, setCart] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [sortMode, setSortMode] = useState('price')
  const [maxDailyPrice, setMaxDailyPrice] = useState(50000)
  const [deliveryMethod, setDeliveryMethod] = useState('pickup')
  const [mapsConfigured, setMapsConfigured] = useState(true)
  const [feeQuote, setFeeQuote] = useState(null)
  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState(null)
  const [couponMessage, setCouponMessage] = useState('')
  const [panel, setPanel] = useState('browse')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [activeSettingsSection, setActiveSettingsSection] = useState('profile')
  const [profileError, setProfileError] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [profileUsername, setProfileUsername] = useState(user.username || '')
  const [profileEmail, setProfileEmail] = useState(user.email || '')
  const [profilePhone, setProfilePhone] = useState(user.phone || '')
  const [profilePassword, setProfilePassword] = useState('')
  const [editingProfileSection, setEditingProfileSection] = useState('')
  const [profileConfirmOpen, setProfileConfirmOpen] = useState(false)
  const [emailOtp, setEmailOtp] = useState('')
  const [emailOtpMessage, setEmailOtpMessage] = useState('')
  const [passwordAuthMethod, setPasswordAuthMethod] = useState('password')
  const [passwordCurrent, setPasswordCurrent] = useState('')
  const [passwordOtp, setPasswordOtp] = useState('')
  const [passwordOtpMessage, setPasswordOtpMessage] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')
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

  const api = useCallback(async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } })
    return readJsonResponse(response)
  }, [token])

  const load = useCallback(async () => {
    setProductsLoading(true)
    try {
      const [catalog, orders, inbox, saved, identity] = await Promise.all([api(`/api/products?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`), api('/api/requests'), api('/api/inbox'), api('/api/wishlist'), api('/api/identity/status')])
      setProducts(catalog.products || [])
      setAddress(catalog.address || '')
      setSavedAddress(catalog.address || '')
      setNic(catalog.nic || '')
      setSavedNic(catalog.nic || '')
      setLoyaltyPoints(catalog.loyaltyPoints || 0)
      setMapsConfigured(catalog.mapsConfigured)
      setRequests(orders.requests || [])
      setNotifications(inbox.notifications || [])
      setWishlist(saved.products || [])
      setIdentityStatus(identity.status || 'not_submitted')
    } catch (loadError) { setError(loadError.message) } finally { setProductsLoading(false) }
  }, [api, startDate, endDate])

  useEffect(() => { load() }, [load])

  const isProvider = user.role === 'rental_shop'
  const unread = notifications.filter((item) => !item.readAt).length
  const categories = useMemo(() => [...new Set(products.map((item) => item.category))].sort(), [products])
  const searchSuggestions = useMemo(() => {
    const normalize = (text) => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const query = normalize(search).trim()
    if (!query) return []
    return [...new Set([...categories, ...products.map((item) => item.title).filter(Boolean)])]
      .filter((suggestion) => normalize(suggestion).includes(query))
      .sort((a, b) => Number(normalize(b).startsWith(query)) - Number(normalize(a).startsWith(query)) || a.localeCompare(b))
      .slice(0, 8)
  }, [products, categories, search])
  const visible = useMemo(() => {
    const normalize = (text) => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const terms = normalize(search).trim().split(/\s+/).filter(Boolean)
    const matches = (item) => {
      const searchable = normalize(`${item.title} ${item.category} ${item.description} ${item.location}`)
      return terms.every((term) => searchable.includes(term)) && (category === 'all' || item.category === category)
    }
    const candidates = products.filter(matches)
    const hoursSelected = endDate && new Date(endDate) > new Date(startDate) ? Math.ceil((new Date(endDate) - new Date(startDate)) / 3600000) : 0
    const daysSelected = Math.max(1, Math.ceil(hoursSelected / 24))
    const effectivePerDay = (item) => (rentalPrice(item, daysSelected, billingUnit === 'hour' && hoursSelected ? hoursSelected : null) + (deliveryMethod === 'partner' ? Number(item.estimatedDeliveryFee || 0) : 0)) / daysSelected
    return candidates.filter((item) => effectivePerDay(item) <= maxDailyPrice)
      .sort((a, b) => sortMode === 'distance' ? (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) : effectivePerDay(a) - effectivePerDay(b))
  }, [products, search, category, sortMode, maxDailyPrice, startDate, endDate, billingUnit, deliveryMethod])
  const cartProducts = cart.map((id) => products.find((product) => product._id === id)).filter(Boolean)
  const hours = endDate && new Date(endDate) > new Date(startDate) ? Math.ceil((new Date(endDate) - new Date(startDate)) / 3600000) : 0
  const days = hours ? Math.ceil(hours / 24) : 0
  const durationLabel = billingUnit === 'hour' ? `${hours} hours` : `${days} days`
  const subtotal = cartProducts.reduce((sum, item) => sum + rentalPrice(item, days, billingUnit === 'hour' ? hours : null), 0)
  const profileReady = /^(?:\d{9}[VX]|\d{12})$/.test(nic) && nic === savedNic && address.length >= 6 && address === savedAddress

  const requestAccountOtp = async () => {
    setPasswordOtpMessage(''); setBusy(true)
    try {
      const result = await api('/api/account/otp/send', { method: 'POST', body: JSON.stringify({ purpose: 'password_change' }) })
      setPasswordOtpMessage(result.message)
    } catch (otpError) {
      setPasswordOtpMessage(otpError.message)
    } finally { setBusy(false) }
  }
  const requestEmailOtp = async () => {
    setEmailOtpMessage(''); setBusy(true)
    try { const result = await api('/api/account/email-otp/send', { method: 'POST', body: JSON.stringify({ email: profileEmail }) }); setEmailOtpMessage(result.message) }
    catch (otpError) { setEmailOtpMessage(otpError.message) } finally { setBusy(false) }
  }
  const saveProfile = async (event) => {
    event.preventDefault(); setProfileError(''); setProfileMessage(''); setBusy(true)
    try {
      const result = await api('/api/account/profile', { method: 'PUT', body: JSON.stringify({ username: profileUsername, email: profileEmail, phone: profilePhone, nic, address, password: profilePassword, emailOtp }) })
      setNic(result.nic); setSavedNic(result.nic); setAddress(result.address); setSavedAddress(result.address); setMapsConfigured(result.mapsConfigured); setFeeQuote(null)
      setProfilePassword(''); setEmailOtp(''); setProfileConfirmOpen(false); setEditingProfileSection(''); setProfileMessage(result.message); onAccountUpdate?.(result.user)
    } catch (saveError) { setProfileError(saveError.message) } finally { setBusy(false) }
  }
  const cancelProfileEdit = () => { setEditingProfileSection(''); setProfileConfirmOpen(false); setProfileError(''); setProfilePassword(''); setEmailOtp(''); setEmailOtpMessage(''); setProfileUsername(user.username || ''); setProfileEmail(user.email || ''); setProfilePhone(user.phone || ''); setNic(savedNic); setAddress(savedAddress) }
  const savePassword = async (event) => {
    event.preventDefault(); setPasswordError(''); setPasswordMessage('')
    if (newPassword !== confirmNewPassword) { setPasswordError('The new passwords do not match.'); return }
    setBusy(true)
    try {
      const result = await api('/api/account/password', { method: 'PUT', body: JSON.stringify({ newPassword, ...(passwordAuthMethod === 'password' ? { password: passwordCurrent } : { verificationOtp: passwordOtp }) }) })
      setPasswordMessage(result.message); setPasswordCurrent(''); setPasswordOtp(''); setNewPassword(''); setConfirmNewPassword('')
    } catch (saveError) { setPasswordError(saveError.message) } finally { setBusy(false) }
  }
  const submitIdentity = async (event) => {
    event.preventDefault(); setIdentityError(''); setIdentityMessage('')
    if (!identityFront || !identityBack) { setIdentityError('Choose clear images of the front and back of your ID.'); return }
    setBusy(true)
    try {
      const result = await api('/api/identity/submit', { method: 'POST', body: JSON.stringify({ front: identityFront, back: identityBack }) })
      setIdentityStatus(result.status); setIdentityMessage(result.message)
    } catch (submitError) { setIdentityError(submitError.message) } finally { setBusy(false) }
  }
  const checkout = async () => {
    setError(''); setMessage(''); setBusy(true)
    try {
      const result = await api('/api/requests', { method: 'POST', body: JSON.stringify({ productIds: cart, startDate, endDate, billingUnit, deliveryMethod, address, couponCode: appliedCoupon?.subtotal === subtotal ? appliedCoupon.code : '' }) })
      setCart([]); setFeeQuote(null); setPanel('requests'); setMessage(result.message); await load()
    } catch (checkoutError) { setError(checkoutError.message) } finally { setBusy(false) }
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
    } catch (wishlistError) { setError(wishlistError.message) }
  }
  const openProductDetails = async (product) => {
    setSelectedProduct(product)
    setProductReviews([])
    setReviewsLoading(true)
    document.getElementById('product-details')?.showModal()
    try {
      const result = await api(`/api/reviews/product/${product._id}`)
      setProductReviews(result.reviews || [])
    } catch { setProductReviews([]) }
    finally { setReviewsLoading(false) }
  }
  const handleProductCardKey = (event, product) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); openProductDetails(product) }
  }
  const applyCoupon = async () => {
    setCouponMessage('')
    try {
      const result = await api('/api/coupons/validate', { method: 'POST', body: JSON.stringify({ code: couponInput, subtotal }) })
      setAppliedCoupon({ code: result.code, discountAmount: result.discountAmount, subtotal })
      setCouponMessage(`${result.code} applied. You save ${money(result.discountAmount)}.`)
    } catch (couponError) { setAppliedCoupon(null); setCouponMessage(couponError.message) }
  }
  const calculateDelivery = async () => {
    setError(''); setFeeQuote(null); setBusy(true)
    try { const quote = await api('/api/delivery/quote', { method: 'POST', body: JSON.stringify({ productIds: cart }) }); setFeeQuote(quote) }
    catch (quoteError) { setError(quoteError.message) } finally { setBusy(false) }
  }
  const openInbox = async () => { setPanel('inbox'); try { await api('/api/inbox/read', { method: 'PATCH', body: '{}' }); await load() } catch (inboxError) { setError(inboxError.message) } }
  const switchSettingsSection = (section) => { if (editingProfileSection) cancelProfileEdit(); setActiveSettingsSection(section); setProfileError(''); setProfileMessage(''); setPasswordError(''); setPasswordMessage(''); requestAnimationFrame(() => document.getElementById('profile-settings')?.scrollTo({ top: 0, behavior: 'smooth' })) }
  const openProfileSettings = (section = 'profile') => { setProfileMenuOpen(false); setActiveSettingsSection(section); setEditingProfileSection(''); setProfileConfirmOpen(false); setProfileError(''); setProfileMessage(''); setPasswordError(''); setPasswordMessage(''); setEmailOtpMessage(''); setPasswordOtpMessage(''); setEmailOtp(''); setPasswordOtp(''); setProfilePassword(''); setPasswordCurrent(''); setProfileUsername(user.username || ''); setProfileEmail(user.email || ''); setProfilePhone(user.phone || ''); setNic(savedNic); setAddress(savedAddress); const dialog = document.getElementById('profile-settings'); if (!dialog?.open) dialog?.showModal(); requestAnimationFrame(() => dialog?.scrollTo({ top: 0, behavior: 'auto' })) }
  const changeBillingUnit = (unit) => {
    setBillingUnit(unit)
    setStartDate((value) => value ? (unit === 'hour' ? `${value.slice(0, 10)}T09:00` : value.slice(0, 10)) : '')
    setEndDate((value) => value ? (unit === 'hour' ? `${value.slice(0, 10)}T17:00` : value.slice(0, 10)) : '')
    setCart([]); setFeeQuote(null)
  }

  if (isProvider) return <OwnerHome user={user} api={api} onLogout={onLogout} />
  if (user.role === 'delivery_partner') return <DeliveryHome user={user} api={api} onLogout={onLogout} />

  return (
    <main className="marketplace">
      <header className="market-nav">
        <a className="market-brand" href="/"><span className="market-logo">r</span>RentEase</a>
        <div className="market-actions">
          <button className={`market-icon-button${panel === 'requests' ? ' active' : ''}`} aria-label="My rentals" title="My rentals" onClick={() => setPanel('requests')}><Icon name="rent" /></button>
          <button className={`market-icon-button${panel === 'wishlist' ? ' active' : ''}`} aria-label="Wishlist" title="Wishlist" onClick={() => setPanel('wishlist')}><Icon name="wishlist" /></button>
          <button className={`market-icon-button${panel === 'inbox' ? ' active' : ''}`} aria-label="Mailbox" title="Mailbox" onClick={openInbox}><Icon name="mail" />{unread > 0 && <b className="inbox-count">{unread}</b>}</button>
          <div className="profile-menu-wrap">
            <button className="profile-trigger" aria-expanded={profileMenuOpen} aria-label="Open profile menu" onClick={() => setProfileMenuOpen((open) => !open)}><span className="profile-avatar">{user.username?.[0]?.toUpperCase() || 'U'}</span><span className="profile-trigger-name">{user.username}</span><Icon name="chevron" /></button>
            {profileMenuOpen && <div className="profile-dropdown"><div className="profile-dropdown-info"><span className="profile-dropdown-avatar">{user.username?.charAt(0)?.toUpperCase() || 'U'}</span><div><b>{user.username}</b><small>{user.email}</small><small>{loyaltyPoints} loyalty points</small></div></div><div className="profile-dropdown-sections"><button type="button" className="profile-dropdown-item" onClick={() => openProfileSettings('profile')}><span className="profile-item-icon"><Icon name="profile" /></span><span><b>Profile</b><small>Your name and NIC</small></span><Icon name="chevron" /></button><button type="button" className="profile-dropdown-item" onClick={() => openProfileSettings('contact')}><span className="profile-item-icon"><Icon name="contact" /></span><span><b>Contact information</b><small>Email, phone and address</small></span><Icon name="chevron" /></button><button type="button" className="profile-dropdown-item" onClick={() => openProfileSettings('security')}><span className="profile-item-icon"><Icon name="security" /></span><span><b>Security</b><small>Password and verification</small></span><Icon name="chevron" /></button></div></div>}
          </div>
          <button className="market-logout" onClick={animateSignOut}>Sign out</button>
        </div>
      </header>

      <div className="market-content">
        {panel === 'browse' && <>
          <section className="market-hero"><div><span className="market-kicker">RENT WELL · SHARE MORE</span><h1>Make room for<br /><em>good things.</em></h1><p>Find useful gear from local people and shops. Choose your dates to see what’s ready to rent.</p></div><div className="hero-orbit" aria-hidden="true"><span>RENT<br />LOCAL</span></div></section>
          <section className="search-panel" aria-label="Search rentals"><label className="search-field"><span>Search rentals</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tools, cameras, event gear" list="rental-search-suggestions" autoComplete="off" /><datalist id="rental-search-suggestions">{searchSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist></label><label><span>From</span><input type={billingUnit === 'hour' ? 'datetime-local' : 'date'} min={billingUnit === 'hour' ? today + 'T00:00' : today} value={startDate} onChange={(event) => { setStartDate(event.target.value); setCart([]); setFeeQuote(null) }} /></label><label><span>Until</span><input type={billingUnit === 'hour' ? 'datetime-local' : 'date'} min={startDate || today} value={endDate} onChange={(event) => { setEndDate(event.target.value); setCart([]); setFeeQuote(null) }} /></label><label><span>Pricing</span><select value={billingUnit} onChange={(event) => changeBillingUnit(event.target.value)}><option value="day">By day / week</option><option value="hour">By hour</option></select></label><label><span>Fulfilment</span><select value={deliveryMethod} onChange={(event) => { setDeliveryMethod(event.target.value); setFeeQuote(null) }}><option value="pickup">Self pickup</option><option value="partner">Partner delivery</option></select></label><button className="search-button" onClick={load}>Find items</button></section>
          <div className="market-controls"><label>Sort listings<select value={sortMode} onChange={(event) => setSortMode(event.target.value)}><option value="price">Lowest effective price first</option><option value="distance">Nearest first</option></select></label><label className="price-range">Maximum effective price / day <b>{money(maxDailyPrice)}</b><input type="range" min="500" max="50000" step="500" value={maxDailyPrice} onChange={(event) => setMaxDailyPrice(Number(event.target.value))} /></label><small>Price ordering includes the estimated delivery fee when delivery is selected.</small></div>
          <div className="market-section-heading"><div>{search && <small className="search-result-count">{visible.length} matching listings for {search}</small>}</div><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category"><option value="all">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></div>
          {error && <div className="market-alert error" role="alert">{error}</div>}{message && <div className="market-alert success" role="status">{message}</div>}
          <div className={`product-grid${productsLoading ? ' product-grid-loading' : search ? ' product-grid-searching' : ''}`} aria-busy={productsLoading}>{productsLoading ? Array.from({ length: 6 }, (_, index) => <div className="listing-skeleton" key={index}><div className="skeleton-image" /><div className="skeleton-lines"><i /><i /><i /></div></div>) : <>{visible.map((item) => <article className="listing-card" key={item._id} onClick={() => openProductDetails(item)} onKeyDown={(event) => handleProductCardKey(event, item)} tabIndex={0}><div className="listing-image"><button type="button" className="wishlist-toggle" aria-label={wishlist.some((saved) => saved._id === item._id) ? "Remove from wishlist" : "Save to wishlist"} aria-pressed={wishlist.some((saved) => saved._id === item._id)} onClick={(event) => { event.stopPropagation(); toggleWishlist(item) }}>{wishlist.some((saved) => saved._id === item._id) ? "\u2665" : "\u2661"}</button>{item.photos?.[0] ? <img src={item.photos[0]} alt={item.title} /> : <span aria-hidden="true">✳</span>}<span className={`availability ${days && !item.available ? 'unavailable' : ''}`}>{!days ? 'Select valid dates' : item.available ? 'Available' : 'Unavailable'}</span></div><div className="listing-info"><div className="listing-meta"><span>{item.category}</span><span>{item.distanceKm == null ? item.location : `${item.distanceKm.toFixed(1)} km away`}</span></div><h3>{item.title}</h3><p>{item.description}</p>{item.specifications?.length > 0 && <small className="listing-specs">{item.specifications.slice(0, 3).map((spec) => `${spec.name}: ${spec.value}`).join("\u00b7")}</small>}<div className="listing-bottom"><div><b>{money(billingUnit === 'hour' && item.hourlyRate ? item.hourlyRate : item.dailyRate)}</b><small>{billingUnit === 'hour' && item.hourlyRate ? ' / hour' : ' / day'}</small><small className="lead-time">Typical lead time {item.leadTimeHours ?? 24}h</small><small className="lead-time">Deposit {money(item.depositAmount || 0)}</small>{item.weeklyRate > 0 && <small className="lead-time">Weekly {money(item.weeklyRate)}{item.longRentalDiscountPercent ? ` \u00b7 ${item.longRentalDiscountPercent}% long-rental discount` : ""}</small>}</div><button disabled={!endDate || !days || !item.available || cart.includes(item._id)} onClick={(event) => { event.stopPropagation(); setCart((previous) => [...previous, item._id]); setFeeQuote(null) }}>{cart.includes(item._id) ? 'Added' : !item.available && days ? 'Unavailable' : '＋ Add to request'}</button></div></div></article>)}{!visible.length && <div className="market-empty">No listings match those filters.</div>}</>}</div>
        </>}

        {panel === 'wishlist' && <section className="requests-page"><span className="market-kicker">YOUR SAVED LISTINGS</span><h1>Wishlist</h1><p>Keep useful items together while you compare rental options.</p>{wishlist.length ? <div className="product-grid wishlist-grid">{wishlist.map((item) => <article className="listing-card" key={item._id} onClick={() => openProductDetails(item)} onKeyDown={(event) => handleProductCardKey(event, item)} tabIndex={0}><div className="listing-image">{item.photos?.[0] && <img src={item.photos[0]} alt={item.title} />}</div><div className="listing-info"><div className="listing-meta"><span>{item.category}</span><span>{item.location}</span></div><h3>{item.title}</h3><p>{item.description}</p><div className="listing-bottom"><div><b>{money(item.dailyRate)}</b><small> / day</small></div><button onClick={(event) => { event.stopPropagation(); toggleWishlist(item) }}>Remove</button></div></div></article>)}</div> : <div className="market-empty">Save listings with the heart button and they will appear here.</div>}</section>}

        {panel === 'requests' && <section className="requests-page"><span className="market-kicker">YOUR ACCOUNT</span><h1>My rental requests</h1><p>Track provider decisions and delivery assignments here.</p>{requests.length ? requests.map((request) => <RequestCard key={request._id} request={request} />) : <div className="market-empty">You haven’t requested a rental yet.</div>}</section>}
        {panel === 'inbox' && <section className="requests-page"><span className="market-kicker">UPDATES</span><h1>Your mailbox</h1><p>Provider decisions and delivery updates for your rental requests.</p>{notifications.length ? notifications.map((item) => <article className={`notification-row ${item.readAt ? '' : 'unread'}`} key={item._id}><span className="notification-mark">✳</span><div><h3>{item.title}</h3><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div></article>) : <div className="market-empty">No messages yet. Updates will appear here.</div>}</section>}
      </div>

      {cartProducts.length > 0 && <aside className="cart-dock"><div className="cart-summary"><span className="cart-bubble">{cartProducts.length}</span><div><b>{cartProducts.length} {cartProducts.length === 1 ? 'item' : 'items'} in your request</b><small>{days ? `${days} days · ${money(subtotal)} before delivery` : 'Choose a valid rental end date'}</small></div></div><button className="cart-link" onClick={() => document.getElementById('rental-checkout')?.showModal()}>Review request →</button></aside>}
            <dialog className="profile-dialog account-settings-dialog" id="profile-settings">
        <form method="dialog" className="dialog-close"><button aria-label="Close account settings">Close</button></form>
        <div className="account-settings-heading"><span className="account-settings-avatar" aria-hidden="true">{profileUsername.trim().charAt(0).toUpperCase() || 'U'}</span><div><span className="market-kicker">YOUR ACCOUNT</span><h2>{({ profile: 'Profile', contact: 'Contact information', security: 'Security', verification: 'Identity verification' })[activeSettingsSection]}</h2><p>{({ profile: 'Manage your name and identity details.', contact: 'Manage your email, phone, and rental address.', security: 'Keep your account protected.', verification: 'Manage your identity verification.' })[activeSettingsSection]}</p></div><span className="account-type-pill">Customer</span></div>
        <nav className="account-settings-tabs" aria-label="Account settings sections"><button type="button" className={activeSettingsSection === 'profile' ? 'active' : ''} onClick={() => switchSettingsSection('profile')}><Icon name="profile" />Profile</button><button type="button" className={activeSettingsSection === 'contact' ? 'active' : ''} onClick={() => switchSettingsSection('contact')}><Icon name="contact" />Contact information</button><button type="button" className={activeSettingsSection === 'security' ? 'active' : ''} onClick={() => switchSettingsSection('security')}><Icon name="security" />Security</button><button type="button" className={activeSettingsSection === 'verification' ? 'active' : ''} onClick={() => switchSettingsSection('verification')}><Icon name="settings" />Verification</button></nav>
        <form className="profile-form account-profile-form" onSubmit={saveProfile}>
          {activeSettingsSection === 'profile' && <section className="settings-section" id="settings-personal"><div className="settings-section-heading"><span className="settings-icon"><Icon name="profile" /></span><div><h3>Profile</h3><p>Your name and national identity number.</p></div>{editingProfileSection === 'profile' ? <button type="button" className="settings-edit-button" onClick={cancelProfileEdit}>Cancel</button> : <button type="button" className="settings-edit-button" onClick={() => { setEditingProfileSection('profile'); setProfileMessage(''); setProfileError('') }}><Icon name="edit" /> Edit</button>}</div>
            <div className="settings-fields"><label>Full name<input value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} maxLength="50" autoComplete="name" readOnly={editingProfileSection !== 'profile'} required /></label><label>National identity card number<input value={nic} onChange={(event) => setNic(event.target.value.toUpperCase().replace(/\s+/g, ''))} maxLength="12" placeholder="e.g. 123456789V" autoComplete="off" readOnly={editingProfileSection !== 'profile'} /></label></div>
            {editingProfileSection === 'profile' && <ProfileEditActions confirming={profileConfirmOpen} busy={busy} password={profilePassword} setPassword={setProfilePassword} onRequestSave={() => { setProfileConfirmOpen(true); setProfileError(''); setProfilePassword('') }} onCancelConfirm={() => { setProfileConfirmOpen(false); setProfileError(''); setProfilePassword('') }} />}
          </section>}
          {activeSettingsSection === 'contact' && <section className="settings-section" id="settings-contact"><div className="settings-section-heading"><span className="settings-icon"><Icon name="contact" /></span><div><h3>Contact information</h3><p>Where we can reach you and where rentals should be delivered.</p></div>{editingProfileSection === 'contact' ? <button type="button" className="settings-edit-button" onClick={cancelProfileEdit}>Cancel</button> : <button type="button" className="settings-edit-button" onClick={() => { setEditingProfileSection('contact'); setProfileMessage(''); setProfileError('') }}><Icon name="edit" /> Edit</button>}</div>
            <div className="settings-fields"><label>Contact phone<input value={profilePhone} onChange={(event) => setProfilePhone(event.target.value)} maxLength="24" autoComplete="tel" readOnly={editingProfileSection !== 'contact'} required /></label>
              <label>Email address<input type="email" value={profileEmail} onChange={(event) => { setProfileEmail(event.target.value); setEmailOtp(''); setEmailOtpMessage('') }} autoComplete="email" readOnly={editingProfileSection !== 'contact'} required />
                {editingProfileSection === 'contact' && profileEmail.trim().toLowerCase() !== user.email?.toLowerCase() && <><button type="button" className="settings-secondary-button" onClick={requestEmailOtp} disabled={busy}>Send verification code to new email</button>{emailOtpMessage && <small className="settings-note">{emailOtpMessage}</small>}<input aria-label="New email verification code" inputMode="numeric" autoComplete="one-time-code" maxLength="6" placeholder="6-digit code sent to new email" value={emailOtp} onChange={(event) => setEmailOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required /></>}
              </label>
              <label className="settings-field-wide">Default address<input value={address} onChange={(event) => { setAddress(event.target.value); setFeeQuote(null) }} maxLength="300" placeholder="Street, town, and nearby landmark" autoComplete="street-address" readOnly={editingProfileSection !== 'contact'} required /></label>
            </div>
            {editingProfileSection === 'contact' && <ProfileEditActions confirming={profileConfirmOpen} busy={busy} password={profilePassword} setPassword={setProfilePassword} onRequestSave={() => { setProfileConfirmOpen(true); setProfileError(''); setProfilePassword('') }} onCancelConfirm={() => { setProfileConfirmOpen(false); setProfileError(''); setProfilePassword('') }} />}
          </section>}
          {['profile', 'contact'].includes(activeSettingsSection) && <>{profileError && <div className="market-alert error" role="alert">{profileError}</div>}{profileMessage && <div className="market-alert success" role="status">{profileMessage}</div>}</>}
        </form>
        {activeSettingsSection === 'security' && <section className="settings-section password-settings-section" id="settings-security"><div className="settings-section-heading"><span className="settings-icon"><Icon name="security" /></span><div><h3>Security</h3><p>Update your password and protect your account.</p></div></div>
          <form className="password-settings-form" onSubmit={savePassword}>
            <div className="settings-methods"><label><input type="radio" name="password-auth-method" checked={passwordAuthMethod === 'password'} onChange={() => setPasswordAuthMethod('password')} /> Current password</label><label><input type="radio" name="password-auth-method" checked={passwordAuthMethod === 'otp'} onChange={() => setPasswordAuthMethod('otp')} /> Email code</label></div>
            {passwordAuthMethod === 'password' ? <label>Current password<input type="password" value={passwordCurrent} onChange={(event) => setPasswordCurrent(event.target.value)} autoComplete="current-password" required /></label> : <div className="settings-code-entry"><button type="button" className="settings-secondary-button" onClick={requestAccountOtp} disabled={busy}>Send code to account email</button><input aria-label="Password change verification code" inputMode="numeric" autoComplete="one-time-code" maxLength="6" placeholder="6-digit verification code" value={passwordOtp} onChange={(event) => setPasswordOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required />{passwordOtpMessage && <small className="settings-note">{passwordOtpMessage}</small>}</div>}
            <div className="settings-fields"><label>New password<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength="10" maxLength="128" autoComplete="new-password" required /><small>Use at least 10 characters.</small></label><label>Confirm new password<input type="password" value={confirmNewPassword} onChange={(event) => setConfirmNewPassword(event.target.value)} minLength="10" maxLength="128" autoComplete="new-password" required /></label></div>
            {passwordError && <div className="market-alert error" role="alert">{passwordError}</div>}{passwordMessage && <div className="market-alert success" role="status">{passwordMessage}</div>}
            <button className="checkout-submit settings-save-button" disabled={busy}>{busy ? 'Updating password…' : 'Update password'}</button>
          </form>
        </section>}
        {activeSettingsSection === 'verification' && <section className="identity-submit settings-identity-section" id="settings-identity"><div><small className="market-kicker">IDENTITY VERIFICATION</small><h3>{({ not_submitted: 'Not submitted', pending: 'Waiting for admin review', approved: 'Identity verified', rejected: 'Please resubmit your ID' })[identityStatus] || 'Not submitted'}</h3><p>Upload both sides of your identity document for admin review.</p></div>{identityStatus !== 'approved' && identityStatus !== 'pending' && <form onSubmit={submitIdentity}><label>Front side<input type="file" accept="image/jpeg,image/png,image/webp" required onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 3 * 1024 * 1024) { setIdentityError('Each ID image must be under 3 MB.'); return } try { setIdentityFront(await readImageData(file)) } catch { setIdentityError('Could not read this image.') } }} /></label><label>Back side<input type="file" accept="image/jpeg,image/png,image/webp" required onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 3 * 1024 * 1024) { setIdentityError('Each ID image must be under 3 MB.'); return } try { setIdentityBack(await readImageData(file)) } catch { setIdentityError('Could not read this image.') } }} /></label>{identityError && <small className="identity-feedback error">{identityError}</small>}{identityMessage && <small className="identity-feedback">{identityMessage}</small>}<button className="checkout-submit" disabled={busy || !identityFront || !identityBack}>{busy ? 'Submitting…' : 'Submit for verification'}</button></form>}{identityStatus === 'pending' && <p className="identity-feedback">Your documents are awaiting an admin decision.</p>}</section>}
      </dialog>
      <dialog className="checkout-dialog" id="rental-checkout"><form method="dialog" className="dialog-close"><button aria-label="Close rental request">Close</button></form><span className="market-kicker">REVIEW & SEND</span><h2>Your rental request</h2>{profileReady ? <div className="checkout-profile-summary"><span>NIC and delivery address are saved.</span><button type="button" onClick={() => openProfileSettings()}>Edit profile details</button></div> : <><p className="profile-dialog-intro">Add your NIC and default address to continue with this rental request.</p><div className="checkout-profile-fields"><p>Complete your contact details, NIC, and default address in account settings before sending a rental request.</p><button type="button" className="quote-button" disabled={busy} onClick={() => openProfileSettings()}>Open account settings</button></div></>}<div className="checkout-items">{cartProducts.map((item) => <div key={item._id}><span>{item.title}</span><b>{money(rentalPrice(item, days, billingUnit === "hour" ? hours : null))}</b></div>)}</div><p className="checkout-period">{startDate} to {endDate} | {durationLabel}</p><div className="delivery-options"><label><input type="radio" name="delivery" checked={deliveryMethod === "pickup"} onChange={() => { setDeliveryMethod("pickup"); setFeeQuote(null) }} /><span><b>Pick up yourself</b><small>No delivery fee</small></span></label><label><input type="radio" name="delivery" checked={deliveryMethod === "partner"} onChange={() => { setDeliveryMethod("partner"); setFeeQuote(null) }} /><span><b>Delivery partner</b><small>Automatically assigned after providers accept</small></span></label></div>{deliveryMethod === "partner" && <><p className="checkout-address">Deliver to: {savedAddress || "Save a default address first"}</p>{address !== savedAddress && <small className="fee-note">Save your edited address before calculating the route.</small>}<button className="quote-button" type="button" disabled={busy || !mapsConfigured || !profileReady} onClick={calculateDelivery}>{busy ? "Calculating route..." : feeQuote ? "Recalculate delivery fee" : "Calculate delivery fee"}</button></>}{error && <div className="market-alert error">{error}</div>}<div className="coupon-entry"><label>Coupon code<input value={couponInput} onChange={(event) => { setCouponInput(event.target.value.toUpperCase()); setAppliedCoupon(null); setCouponMessage("") }} placeholder="Enter code" /></label><button type="button" disabled={!couponInput.trim() || !subtotal} onClick={applyCoupon}>Apply</button></div>{couponMessage && <small className={appliedCoupon?.subtotal === subtotal ? "coupon-success" : "coupon-error"}>{couponMessage}</small>}<div className="checkout-total"><span>Rental subtotal</span><b>{money(subtotal)}</b></div>{appliedCoupon?.subtotal === subtotal && <div className="checkout-total coupon-total"><span>Coupon {appliedCoupon.code}</span><b>?{money(appliedCoupon.discountAmount)}</b></div>}{deliveryMethod === "partner" && feeQuote && <><div className="checkout-total"><span>Route ({feeQuote.distanceKm.toFixed(1)} km, about {feeQuote.etaMinutes} min)</span><b>{money(feeQuote.deliveryFee)}</b></div><div className="checkout-total"><span>Total estimate</span><b>{money(subtotal - (appliedCoupon?.subtotal === subtotal ? appliedCoupon.discountAmount : 0) + feeQuote.deliveryFee)}</b></div><small className="fee-note">Distance calculated with Google Maps Routes. Current pricing rates are configurable in server/.env.</small></>}{deliveryMethod === "partner" && !feeQuote && <small className="fee-note">Calculate the route to see the delivery fee before sending.</small>}{!profileReady && <div className="market-alert error">Save a valid NIC and default address to continue.</div>}<button className="checkout-submit" disabled={busy || !days || !profileReady || (deliveryMethod === "partner" && (!mapsConfigured || !feeQuote))} onClick={(event) => { event.preventDefault(); document.getElementById("rental-checkout")?.close(); checkout() }}>{busy ? "Sending request..." : "Send rental request"}</button></dialog>
      <dialog className="product-detail-dialog" id="product-details" onClose={() => setSelectedProduct(null)}>
        <form method="dialog" className="dialog-close"><button aria-label="Close item details">Close</button></form>
        {selectedProduct && <div className="product-detail-layout"><div className="product-detail-gallery">{selectedProduct.photos?.[0] ? <img className="product-detail-main-image" src={selectedProduct.photos[0]} alt={selectedProduct.title} /> : <div className="product-detail-image-empty">✳</div>}{selectedProduct.photos?.length > 1 && <div className="product-detail-thumbnails">{selectedProduct.photos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt={`${selectedProduct.title} view ${index + 1}`} />)}</div>}</div><div className="product-detail-copy"><span className="market-kicker">{selectedProduct.category}</span><h2>{selectedProduct.title}</h2><div className="product-detail-rating"><b aria-label={`${Number(selectedProduct.ratingAverage || 0).toFixed(1)} out of 5 stars`}>★ {Number(selectedProduct.ratingAverage || 0).toFixed(1)}</b><span>{selectedProduct.ratingCount || 0} {Number(selectedProduct.ratingCount || 0) === 1 ? 'review' : 'reviews'}</span></div><p className="product-detail-description">{selectedProduct.description}</p><div className="product-detail-price"><b>{money(selectedProduct.dailyRate)}<small> / day</small></b>{selectedProduct.hourlyRate > 0 && <span>{money(selectedProduct.hourlyRate)} / hour</span>}{selectedProduct.weeklyRate > 0 && <span>{money(selectedProduct.weeklyRate)} / week</span>}</div><div className="product-detail-facts"><div><small>Rental shop</small><b>{selectedProduct.providerId?.shopName || selectedProduct.providerId?.username || 'Community provider'}</b></div><div><small>Shop location</small><b>{selectedProduct.location || 'Location not provided'}</b></div><div><small>Lead time</small><b>{selectedProduct.leadTimeHours ?? 24} hours</b></div><div><small>Refundable deposit</small><b>{money(selectedProduct.depositAmount)}</b></div></div>{selectedProduct.specifications?.length > 0 && <section className="product-detail-specs"><h3>Item details</h3><dl>{selectedProduct.specifications.map((spec, index) => <div key={`${spec.name}-${index}`}><dt>{spec.name}</dt><dd>{spec.value}</dd></div>)}</dl></section>}<section className="product-detail-reviews"><div className="product-detail-reviews-heading"><h3>Ratings & reviews</h3><span>{selectedProduct.ratingCount || 0} total</span></div>{reviewsLoading ? <p className="product-detail-reviews-empty">Loading reviews…</p> : productReviews.length ? productReviews.map((review) => <article className="product-detail-review" key={review._id}><div><b>{review.authorId?.username || 'Customer'}</b><span>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div><small>{new Date(review.createdAt).toLocaleDateString()}</small>{review.comment && <p>{review.comment}</p>}</article>) : <p className="product-detail-reviews-empty">No reviews yet. Reviews appear after completed rentals.</p>}</section><button type="button" className="checkout-submit product-detail-add" disabled={!endDate || !days || !selectedProduct.available || cart.includes(selectedProduct._id)} onClick={() => { setCart((previous) => [...previous, selectedProduct._id]); setFeeQuote(null); document.getElementById('product-details')?.close() }}>{cart.includes(selectedProduct._id) ? 'Added to request' : selectedProduct.available ? 'Add to rental request' : 'Unavailable for selected dates'}</button></div></div>}
      </dialog>
      <footer className="market-footer"><a className="market-footer-brand" href="/"><span className="market-logo">r</span>RentEase</a><p>Useful things, shared by your community.</p><small>© {new Date().getFullYear()} RentEase</small></footer>
      {signingOut && <div className="signout-scene" role="status" aria-label="Signing out"><div className="signout-door"><span /><i /></div><div className="signout-person"><i /><b /></div></div>}
    </main>
  )
}

function RequestCard({ request, provider = false, api, onRefresh }) {
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const decide = async (item, decision) => {
    setBusyId(String(item.productId)); setError('')
    try { await api(`/api/provider/requests/${request._id}/items/${item.productId}`, { method: 'PATCH', body: JSON.stringify({ decision }) }); await onRefresh() }
    catch (actionError) { setError(actionError.message) } finally { setBusyId('') }
  }
  return <article className="request-card"><div className="request-card-head"><div><span className="request-date">Requested {new Date(request.createdAt).toLocaleDateString()}</span><h2>{provider ? `Request from ${request.customerId?.username || 'customer'}` : request.items.map((item) => item.title).join(', ')}</h2></div><span className="request-state">{provider ? 'Provider review' : requestStatus(request)}</span></div><p className="request-details">{new Date(request.startDate).toLocaleDateString()} – {new Date(request.endDate).toLocaleDateString()} · {request.deliveryMethod === 'pickup' ? 'Customer pickup' : `Partner delivery · ${request.distanceKm.toFixed(1)} km · est. ${request.etaMinutes} min`}</p>{!provider && request.deliveryMethod === "partner" && <p className="request-details">Delivery tracking: {request.items.map((item) => `${item.title}: ${(item.deliveryStatus || "assigned").replaceAll("_", " ")}`).join(" ? ")}</p>}{provider && <p className="request-details">Customer: {request.customerId?.username} · {request.customerId?.email} · {request.customerId?.phone}</p>}<div className="request-items">{request.items.map((item) => <div key={item.productId}><span>{item.title} <small>· {item.decision}</small>{item.assignedPartner && <small> · partner assigned: {item.assignedPartner.username}</small>}</span>{provider && item.decision === 'pending' && <span className="decision-actions"><button disabled={Boolean(busyId)} onClick={() => decide(item, 'rejected')}>Decline</button><button disabled={Boolean(busyId)} onClick={() => decide(item, 'accepted')}>{busyId === String(item.productId) ? 'Saving…' : 'Accept'}</button></span>}</div>)}</div><div className="request-total"><span>{request.deliveryMethod === 'partner' ? `Delivery · ${money(request.deliveryFee)}` : 'Pickup · no delivery fee'}</span><b>{money(request.total)}</b></div>{error && <div className="market-alert error">{error}</div>}</article>
}

function ProviderHome({ user, api, onLogout }) {
  const [requests, setRequests] = useState([])
  const [panel, setPanel] = useState('requests')
  const [error, setError] = useState('')
  const load = useCallback(async () => { try { const result = await api('/api/provider/requests'); setRequests(result.requests || []) } catch (loadError) { setError(loadError.message) } }, [api])
  useEffect(() => { load() }, [load])
  return <main className="marketplace"><header className="market-nav"><a className="market-brand" href="/"><span className="market-logo">r</span>RentEase</a><nav><button className={panel === 'requests' ? 'selected' : ''} onClick={() => setPanel('requests')}>Incoming requests</button></nav><div className="market-user"><span>{user.shopName || user.username}</span><button onClick={onLogout}>Sign out</button></div></header><div className="market-content requests-page"><span className="market-kicker">PROVIDER WORKSPACE</span><h1>Rental requests</h1><p>Review each item and accept or decline it. Delivery partners are assigned automatically after acceptance.</p>{error && <div className="market-alert error">{error}</div>}{requests.length ? requests.map((request) => <RequestCard key={request._id} request={request} provider api={api} onRefresh={load} />) : <div className="market-empty">No requests yet. New customer requests will appear here.</div>}</div></main>
}

function PartnerHome({ user, api, onLogout }) {
  const [assignments, setAssignments] = useState([])
  const [notifications, setNotifications] = useState([])
  const [panel, setPanel] = useState('assignments')
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { const [jobs, inbox] = await Promise.all([api('/api/delivery/assignments'), api('/api/inbox')]); setAssignments(jobs.requests || []); setNotifications(inbox.notifications || []) }
    catch (loadError) { setError(loadError.message) }
  }, [api])
  useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer) }, [load])
  return <main className="marketplace"><header className="market-nav"><a className="market-brand" href="/"><span className="market-logo">r</span>RentEase</a><nav><button className={panel === 'assignments' ? 'selected' : ''} onClick={() => setPanel('assignments')}>My deliveries</button><button className={panel === 'inbox' ? 'selected' : ''} onClick={() => setPanel('inbox')}>Mailbox</button></nav><div className="market-user"><span>{user.username}</span><button onClick={onLogout}>Sign out</button></div></header><div className="market-content requests-page"><span className="market-kicker">DELIVERY PARTNER</span><h1>{panel === 'inbox' ? 'Your mailbox' : 'Assigned deliveries'}</h1><p>Updates and customer delivery details for jobs assigned to you.</p>{error && <div className="market-alert error">{error}</div>}{panel === 'inbox' ? notifications.map((item) => <article className="notification-row" key={item._id}><span className="notification-mark">✳</span><div><h3>{item.title}</h3><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString()}</small></div></article>) : assignments.map((request) => <article className="request-card" key={request._id}><div className="request-card-head"><div><span className="request-date">Delivery assigned</span><h2>{request.items.map((item) => item.title).join(', ')}</h2></div><span className="request-state">{request.items.some((item) => item.decision === 'accepted') ? 'Ready' : 'Provider review'}</span></div><p className="request-details">Customer: {request.customerId?.username} · {request.customerId?.phone || 'No phone on file'}</p><p className="request-details">Deliver to: {request.address}</p><p className="request-details">{new Date(request.startDate).toLocaleDateString()} – {new Date(request.endDate).toLocaleDateString()} · {request.distanceKm.toFixed(1)} km · approx. {request.etaMinutes} min</p><div className="request-total"><span>Delivery fee for request</span><b>{money(request.deliveryFee)}</b></div></article>)}{panel === 'assignments' && !assignments.length && <div className="market-empty">No deliveries are assigned to you yet.</div>}{panel === 'inbox' && !notifications.length && <div className="market-empty">No messages yet.</div>}</div></main>
}

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
      .then((result) => { if (active) setProducts(result.products || []) })
      .catch((loadError) => { if (active) setError(loadError.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const normalize = (text) => String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const categories = [...new Set(products.map((item) => item.category))].sort()
  const terms = normalize(search).trim().split(/\s+/).filter(Boolean)
  const visible = products.filter((item) => {
    const searchable = normalize(`${item.title} ${item.category} ${item.description} ${item.location}`)
    return terms.every((term) => searchable.includes(term)) && (category === 'all' || item.category === category)
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
      const result = await readJsonResponse(await fetch(`/api/public/reviews/product/${product._id}`), 'Could not load reviews.')
      setProductReviews(result.reviews || [])
    } catch { setProductReviews([]) }
    finally { setReviewsLoading(false) }
  }
  const handleProductCardKey = (event, product) => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); openProductDetails(product) }
  }

  return <main className="marketplace guest-marketplace">
    <header className="market-nav">
      <a className="market-brand" href="/"><span className="market-logo">r</span>RentEase</a>
      <nav aria-label="Main navigation"><a className="guest-nav-current" href="#browse">Explore</a></nav>
      <div className="market-actions"><button className="market-logout" onClick={onSignIn}>Sign in</button></div>
    </header>
    <div className="market-content" id="browse">
      <section className="market-hero"><div><span className="market-kicker">TOOLS · GEAR · SPACES</span><h1>The right gear.<br /><em>Right when you need it.</em></h1><p>Explore useful equipment and everyday essentials shared by people and shops in your community.</p></div><div className="hero-orbit" aria-hidden="true"><span>RENT<br />LOCAL</span></div></section>
      <section className="search-panel guest-search" aria-label="Search rentals">
        <label className="search-field"><span>Search rentals</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try cameras or tools" list="guest-search-suggestions" autoComplete="off" /><datalist id="guest-search-suggestions">{suggestions.map((item) => <option key={item} value={item} />)}</datalist></label>
        <button className="search-button" onClick={() => document.getElementById('guest-listings')?.scrollIntoView({ behavior: 'smooth' })}>Find items</button>
      </section>
      <div className="market-section-heading" id="guest-listings"><div>{search && <small className="search-result-count">{visible.length} matching listings for {search}</small>}</div><select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category"><option value="all">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></div>
      {error && <div className="market-alert error" role="alert">{error}</div>}
      <div className={`product-grid${loading ? ' product-grid-loading' : search ? ' product-grid-searching' : ''}`} aria-busy={loading}>
        {loading ? Array.from({ length: 6 }, (_, index) => <div className="listing-skeleton" key={index}><div className="skeleton-image" /><div className="skeleton-lines"><i /><i /><i /></div></div>) : <>{visible.map((item) => <article className="listing-card" key={item._id} onClick={() => openProductDetails(item)} onKeyDown={(event) => handleProductCardKey(event, item)} tabIndex={0}><div className="listing-image">{item.photos?.[0] ? <img src={item.photos[0]} alt={item.title} /> : <span aria-hidden="true">✳</span>}</div><div className="listing-info"><div className="listing-meta"><span>{item.category}</span><span>{item.location}</span></div><h3>{item.title}</h3><p>{item.description}</p><div className="listing-bottom"><div><b>{money(item.dailyRate)}</b><small> / day</small></div><button onClick={(event) => { event.stopPropagation(); onSignIn() }}>Sign in to rent</button></div></div></article>)}{!visible.length && <div className="market-empty">No listings match those filters.</div>}</>}
      </div>
    </div>
    <dialog className="product-detail-dialog" id="guest-product-details" onClose={() => setSelectedProduct(null)}>
      <form method="dialog" className="dialog-close"><button aria-label="Close item details">Close</button></form>
      {selectedProduct && <div className="product-detail-layout"><div className="product-detail-gallery">{selectedProduct.photos?.[0] ? <img className="product-detail-main-image" src={selectedProduct.photos[0]} alt={selectedProduct.title} /> : <div className="product-detail-image-empty">✳</div>}{selectedProduct.photos?.length > 1 && <div className="product-detail-thumbnails">{selectedProduct.photos.map((photo, index) => <img key={`${photo}-${index}`} src={photo} alt={`${selectedProduct.title} view ${index + 1}`} />)}</div>}</div><div className="product-detail-copy"><span className="market-kicker">{selectedProduct.category}</span><h2>{selectedProduct.title}</h2><div className="product-detail-rating"><b>★ {Number(selectedProduct.ratingAverage || 0).toFixed(1)}</b><span>{selectedProduct.ratingCount || 0} {Number(selectedProduct.ratingCount || 0) === 1 ? 'review' : 'reviews'}</span></div><p className="product-detail-description">{selectedProduct.description}</p><div className="product-detail-price"><b>{money(selectedProduct.dailyRate)}<small> / day</small></b>{selectedProduct.hourlyRate > 0 && <span>{money(selectedProduct.hourlyRate)} / hour</span>}{selectedProduct.weeklyRate > 0 && <span>{money(selectedProduct.weeklyRate)} / week</span>}</div><div className="product-detail-facts"><div><small>Rental shop</small><b>{selectedProduct.providerId?.shopName || selectedProduct.providerId?.username || 'Community provider'}</b></div><div><small>Shop location</small><b>{selectedProduct.location || 'Location not provided'}</b></div><div><small>Lead time</small><b>{selectedProduct.leadTimeHours ?? 24} hours</b></div><div><small>Refundable deposit</small><b>{money(selectedProduct.depositAmount)}</b></div></div>{selectedProduct.specifications?.length > 0 && <section className="product-detail-specs"><h3>Item details</h3><dl>{selectedProduct.specifications.map((spec, index) => <div key={`${spec.name}-${index}`}><dt>{spec.name}</dt><dd>{spec.value}</dd></div>)}</dl></section>}<section className="product-detail-reviews"><div className="product-detail-reviews-heading"><h3>Ratings & reviews</h3><span>{selectedProduct.ratingCount || 0} total</span></div>{reviewsLoading ? <p className="product-detail-reviews-empty">Loading reviews…</p> : productReviews.length ? productReviews.map((review) => <article className="product-detail-review" key={review._id}><div><b>{review.authorId?.username || 'Customer'}</b><span>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div><small>{new Date(review.createdAt).toLocaleDateString()}</small>{review.comment && <p>{review.comment}</p>}</article>) : <p className="product-detail-reviews-empty">No reviews yet. Reviews appear after completed rentals.</p>}</section><button type="button" className="checkout-submit product-detail-add" onClick={onSignIn}>Sign in to rent this item</button></div></div>}
    </dialog>
  </main>
}

function ProfileEditActions({ confirming, busy, password, setPassword, onRequestSave, onCancelConfirm }) {
  if (!confirming) return <div className="profile-edit-actions"><span>Review your updates before saving.</span><button type="button" className="checkout-submit" onClick={onRequestSave} disabled={busy}>Save changes</button></div>
  return <div className="profile-confirm-box"><div><span className="market-kicker">SECURITY CHECK</span><h4>Confirm it’s you</h4><p>Enter your current password to save these changes.</p></div><label>Current password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><div className="profile-confirm-actions"><button type="button" className="settings-secondary-button" onClick={onCancelConfirm} disabled={busy}>Back</button><button type="submit" className="checkout-submit" disabled={busy}>{busy ? 'Saving…' : 'Confirm and save'}</button></div></div>
}

export default UserHome



