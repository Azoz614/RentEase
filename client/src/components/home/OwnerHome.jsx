import { useCallback, useEffect, useMemo, useState } from 'react'
import './workspace.css'

const currency = (value) => `LKR ${Number(value || 0).toLocaleString('en-LK')}`

function readPhotos(files) {
  return Promise.all([...files].map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, data: reader.result })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })))
}

export default function OwnerHome({ user, api, onLogout }) {
  const [section, setSection] = useState('overview')
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [calendarProduct, setCalendarProduct] = useState('all')
  const [products, setProducts] = useState([])
  const [requests, setRequests] = useState([])
  const [photos, setPhotos] = useState([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [inventory, bookingList] = await Promise.all([api('/api/owner/products'), api('/api/provider/requests')])
      setProducts(inventory.products || [])
      setRequests(bookingList.requests || [])
    } catch (loadError) { setError(loadError.message) }
  }, [api])
  useEffect(() => { load() }, [load])

  const visibleProducts = useMemo(() => products.filter((product) => `${product.title} ${product.category}`.toLowerCase().includes(search.toLowerCase())), [products, search])
  const pending = requests.reduce((sum, request) => sum + request.items.filter((item) => item.decision === 'pending').length, 0)
  const accepted = requests.flatMap((request) => request.items.filter((item) => item.decision === 'accepted'))
  const bookedValue = accepted.reduce((sum, item) => sum + Number(item.rentalAmount || 0), 0)

  const submitListing = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const specifications = String(form.get('specifications') || '').split('\n').map((line) => {
      const [name, ...parts] = line.split(':')
      return { name: name.trim(), value: parts.join(':').trim() }
    }).filter((row) => row.name && row.value)
    try {
      const result = await api('/api/owner/products', { method: 'POST', body: JSON.stringify({ title: form.get('title'), category: form.get('category'), description: form.get('description'), dailyRate: Number(form.get('dailyRate')), hourlyRate: form.get('hourlyRate'), weeklyRate: form.get('weeklyRate'), longRentalDiscountPercent: Number(form.get('longRentalDiscountPercent') || 0), depositAmount: Number(form.get('depositAmount') || 0), specifications, photos: photos.map((photo) => photo.data) }) })
      setNotice(result.message); setPhotos([]); formElement.reset(); await load(); setSection('inventory')
    } catch (submitError) { setError(submitError.message) } finally { setBusy(false) }
  }

  const decide = async (requestId, productId, decision) => {
    setBusy(true); setError(''); setNotice('')
    try { const result = await api(`/api/provider/requests/${requestId}/items/${productId}`, { method: 'PATCH', body: JSON.stringify({ decision }) }); setNotice(result.message); await load() }
    catch (actionError) { setError(actionError.message) } finally { setBusy(false) }
  }
  const toggleProduct = async (product) => {
    setBusy(true); setError(''); setNotice('')
    try { const result = await api(`/api/owner/products/${product._id}`, { method: 'PATCH', body: JSON.stringify({ active: !product.active }) }); setNotice(result.message); await load() }
    catch (actionError) { setError(actionError.message) } finally { setBusy(false) }
  }

  return <main className="business-shell">
    <aside className="business-sidebar"><a className="business-brand" href="/"><span>r</span>RentEase <small>BUSINESS</small></a><div className="business-shop-card"><div className="business-avatar">{(user.shopName || user.username || 'S')[0].toUpperCase()}</div><div><b>{user.shopName || user.username}</b><small>Rental shop</small></div><i>Verified</i></div><nav className="business-menu" aria-label="Owner workspace">{[['overview','Overview'],['inventory','Inventory'],['calendar','Availability'],['add','Add a listing'],['bookings','Bookings']].map(([key,label]) => <button key={key} className={section === key ? 'selected' : ''} onClick={() => setSection(key)}><span>{({overview:'◫',inventory:'▦',calendar:'▦',add:'＋',bookings:'▣'})[key]}</span>{label}{key === 'bookings' && pending > 0 && <b>{pending}</b>}</button>)}</nav><div className="business-sidebar-foot"><div><span className="online-dot" />Your shop is live</div><button onClick={onLogout}>Sign out</button></div></aside>
    <section className="business-main"><header className="business-topbar"><div><small>OWNER WORKSPACE / {section.toUpperCase()}</small><h1>{section === 'overview' ? 'Good business starts here.' : section === 'inventory' ? 'Your inventory' : section === 'add' ? 'Create a rental listing' : 'Booking requests'}</h1></div><div className="business-top-actions"><span className="business-location">⌖ Batticaloa, Sri Lanka</span><button onClick={load} aria-label="Refresh workspace">↻</button><span className="business-avatar-small">{(user.username || 'S')[0].toUpperCase()}</span></div></header>
      {error && <div className="workspace-alert is-error" role="alert">{error}</div>}{notice && <div className="workspace-alert" role="status">{notice}</div>}
      {section === 'overview' && <>
        <div className="business-welcome"><div><span className="workspace-kicker">SHOP OVERVIEW</span><h2>{user.shopName || user.username}</h2><p>Manage your catalog and respond to customer requests in one place.</p></div><button onClick={() => setSection('add')}>＋ Add a rental item</button></div>
        <div className="business-stat-grid"><article><span className="business-stat-icon blue">▦</span><small>Active listings</small><b>{products.filter((item) => item.active).length}</b><em>{products.length} total in inventory</em></article><article><span className="business-stat-icon amber">◷</span><small>Requests to review</small><b>{pending}</b><em>Awaiting your decision</em></article><article><span className="business-stat-icon green">✓</span><small>Accepted items</small><b>{accepted.length}</b><em>Across {requests.length} booking requests</em></article><article><span className="business-stat-icon violet">LKR</span><small>Accepted rental value</small><b>{currency(bookedValue)}</b><em>Rental amount, not collected payments</em></article></div>
        <div className="business-overview-grid"><section className="workspace-card"><div className="workspace-card-head"><div><small className="workspace-kicker">NEEDS ATTENTION</small><h2>Latest booking requests</h2></div><button onClick={() => setSection('bookings')}>View all →</button></div>{requests.length ? requests.slice(0,4).map((request) => <BookingRow key={request._id} request={request} decide={decide} busy={busy} />) : <div className="workspace-empty">New customer bookings will appear here.</div>}</section><section className="workspace-card"><div className="workspace-card-head"><div><small className="workspace-kicker">CATALOG SNAPSHOT</small><h2>Recently listed</h2></div><button onClick={() => setSection('inventory')}>Inventory →</button></div>{products.slice(0,5).map((product) => <div className="owner-product-mini" key={product._id}><img src={product.photos?.[0] || ''} alt="" /><div><b>{product.title}</b><small>{product.category} · {currency(product.dailyRate)}/day</small></div><span className={product.active ? 'live-pill' : 'paused-pill'}>{product.active ? 'Live' : 'Paused'}</span></div>)}{!products.length && <div className="workspace-empty">Start by adding your first rental listing.</div>}</section></div>
        <section className="workspace-roadmap"><span>WORKSPACE CAPABILITIES</span><div><b>Available now</b><p>Inventory, booking decisions, date conflict protection, and assigned delivery updates.</p></div><div><b>Next platform services</b><p>Online payment, deposits and refunds, weekly/hourly pricing, invoices, and package builder.</p></div></section>
      </>}
      {section === 'inventory' && <section className="workspace-card inventory-card"><div className="workspace-card-head"><div><small className="workspace-kicker">PRODUCT CATALOG</small><h2>Manage your listings</h2></div><button className="owner-primary" onClick={() => setSection('add')}>＋ New listing</button></div><div className="inventory-toolbar"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your items" /><span>{visibleProducts.length} listings</span></div>{visibleProducts.length ? <div className="owner-inventory-grid">{visibleProducts.map((product) => <article className="owner-inventory-card" key={product._id}><div className="owner-inventory-image">{product.photos?.[0] && <img src={product.photos[0]} alt={product.title} />}<span className={product.active ? 'live-pill' : 'paused-pill'}>{product.active ? 'Available' : 'Paused'}</span></div><div className="owner-inventory-info"><small>{product.category}</small><h3>{product.title}</h3><p>{product.description}</p>{product.specifications?.length > 0 && <ul className="owner-specs">{product.specifications.slice(0,3).map((spec) => <li key={`${spec.name}-${spec.value}`}><b>{spec.name}</b> {spec.value}</li>)}</ul>}<div><b>{currency(product.dailyRate)}</b><span>/ day</span><span className="owner-deposit">Deposit {currency(product.depositAmount)}</span></div><button disabled={busy} onClick={() => toggleProduct(product)}>{product.active ? 'Pause listing' : 'Publish listing'}</button></div></article>)}</div> : <div className="workspace-empty">No listings found. Add a product to build your catalog.</div>}</section>}
      {section === 'calendar' && <AvailabilityCalendar products={products} month={calendarMonth} setMonth={setCalendarMonth} productId={calendarProduct} setProductId={setCalendarProduct} />}
      {section === 'add' && <section className="workspace-card owner-form-card"><div className="workspace-card-head"><div><small className="workspace-kicker">INVENTORY SETUP</small><h2>Tell customers about the item</h2><p>Clear photos and specs help customers choose the right rental.</p></div></div><form className="owner-listing-form" onSubmit={submitListing}><div className="owner-form-two"><label>Product name<input name="title" required maxLength="120" placeholder="e.g. Sony A7 IV camera" /></label><label>Category<select name="category" required defaultValue=""><option value="" disabled>Select category</option>{['Cameras & electronics','Tools & equipment','Construction','Vehicles','Home & garden','Events & spaces','Sports & travel','Other'].map((category) => <option key={category}>{category}</option>)}</select></label></div><label>Description<textarea name="description" required maxLength="3000" rows="4" placeholder="Condition, what is included, pickup instructions..." /></label><div className="owner-form-two"><label>Daily rental rate (LKR)<input name="dailyRate" type="number" min="0" step="1" required placeholder="2500" /></label><label>Weekly rental rate (LKR)<input name="weeklyRate" type="number" min="0" step="1" placeholder="15000 (optional)" /></label><label>Hourly rate (LKR)<input name="hourlyRate" type="number" min="0" step="1" placeholder="Optional" /></label><label>Long rental discount (%)<input name="longRentalDiscountPercent" type="number" min="0" max="90" step="1" defaultValue="0" /></label><label>Refundable deposit amount (LKR)<input name="depositAmount" type="number" min="0" step="1" defaultValue="0" /></label></div><label>Specifications <small>One per line, for example: Brand: Sony</small><textarea name="specifications" rows="3" placeholder={'Brand: Sony\nModel: A7 IV\nCondition: Excellent'} /></label><label className="owner-photo-input">Photos <small>Upload 1–6 JPEG, PNG or WebP images. Maximum 2.5 MB each.</small><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={async (event) => { const files = [...event.target.files]; if (files.length > 6 || files.some((file) => file.size > 2.5 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 15 * 1024 * 1024) { setError('Choose up to 6 photos, each under 2.5 MB, with a 15 MB total.'); setPhotos([]); return } try { const result = await readPhotos(files); setPhotos(result) } catch { setError('Could not read the selected photos.') } }} /></label>{photos.length > 0 && <div className="owner-photo-preview">{photos.map((photo) => <img key={photo.name} src={photo.data} alt={photo.name} />)}</div>}<div className="owner-form-note">Listings are placed in Batticaloa by default. Weekly prices and discounts apply to day-based bookings. Deposits are recorded but are not charged until a payment provider is configured.</div><button className="owner-primary" disabled={busy || photos.length === 0}>{busy ? 'Publishing listing…' : 'Publish listing'}</button></form></section>}
      {section === 'bookings' && <section className="workspace-card"><div className="workspace-card-head"><div><small className="workspace-kicker">CUSTOMER BOOKINGS</small><h2>Review requests by item</h2><p>Requests are protected against overlapping date bookings.</p></div><span className="booking-count">{requests.length} requests</span></div>{requests.length ? requests.map((request) => <BookingRow key={request._id} request={request} decide={decide} busy={busy} expanded />) : <div className="workspace-empty">You do not have any booking requests yet.</div>}</section>}
    </section>
  </main>
}

function BookingRow({ request, decide, busy, expanded = false }) {
  return <article className={`owner-booking-row${expanded ? ' expanded' : ''}`}><div className="owner-booking-main"><div className="owner-booking-date"><b>{new Date(request.startDate).toLocaleDateString()}</b><span>to</span><b>{new Date(request.endDate).toLocaleDateString()}</b></div><div className="owner-booking-copy"><h3>{request.items.map((item) => item.title).join(', ')}</h3><p>{request.customerId?.username || 'Customer'} · requested {new Date(request.createdAt).toLocaleDateString()}</p></div><span className={`booking-status ${request.items.every((item) => item.decision !== 'pending') ? 'resolved' : ''}`}>{request.items.some((item) => item.decision === 'pending') ? 'Needs review' : 'Reviewed'}</span></div>{request.items.map((item) => <div className="owner-booking-item" key={item.productId}><span><b>{item.title}</b><small>{item.decision} · {request.deliveryMethod === 'partner' ? `Partner delivery · ${request.distanceKm?.toFixed(1) || 0} km` : 'Customer pickup'} · {currency(item.dailyRate)}/day</small></span>{item.decision === 'pending' ? <div><button className="owner-decline" disabled={busy} onClick={() => decide(request._id, item.productId, 'rejected')}>Decline</button><button className="owner-accept" disabled={busy} onClick={() => decide(request._id, item.productId, 'accepted')}>Accept</button></div> : <em className={item.decision}>{item.decision}</em>}</div>)}</article>
}

function AvailabilityCalendar({ products, month, setMonth, productId, setProductId }) {
  const activeProducts = productId === 'all' ? products : products.filter((product) => product._id === productId)
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: Math.ceil((startOffset + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - startOffset + 1
    if (day < 1 || day > daysInMonth) return null
    const date = new Date(month.getFullYear(), month.getMonth(), day)
    const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    const slots = activeProducts.flatMap((product) => (product.rentalSlots || []).filter((slot) => new Date(slot.startDate) < nextDate && new Date(slot.endDate) > date).map((slot) => ({ ...slot, title: product.title })))
    return { day, slots }
  })
  return <section className="workspace-card owner-calendar"><div className="workspace-card-head"><div><small className="workspace-kicker">DATE AVAILABILITY</small><h2>Rental availability calendar</h2><p>Pending and accepted requests reserve the selected date range.</p></div><select aria-label="Filter availability calendar by item" value={productId} onChange={(event) => setProductId(event.target.value)}><option value="all">All inventory</option>{products.map((product) => <option value={product._id} key={product._id}>{product.title}</option>)}</select></div><div className="calendar-toolbar"><button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>←</button><b>{month.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</b><button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>→</button></div><div className="calendar-grid">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day) => <b className="calendar-weekday" key={day}>{day}</b>)}{cells.map((cell, index) => cell ? <div className={`calendar-day${cell.slots.length ? ' has-booking' : ''}`} key={cell.day}><b>{cell.day}</b>{cell.slots.slice(0,2).map((slot) => <span key={`${slot.requestId}-${slot.title}`} title={slot.title} className={slot.status === 'accepted' ? 'accepted-slot' : ''}>{slot.title}</span>)}{cell.slots.length > 2 && <small>+{cell.slots.length - 2} more</small>}</div> : <div className="calendar-day outside" key={`outside-${index}`} />)}</div><div className="calendar-legend"><span><i className="pending-key" />Pending request</span><span><i className="accepted-key" />Accepted booking</span></div></section>
}
