import { useEffect, useState } from 'react'
import { readJsonResponse } from '../../utils/readJsonResponse.js'
import './admin.css'

const sections = [
  ['overview', 'Overview'], ['products', 'Products'], ['requests', 'Rental requests'], ['users', 'Users'], ['shops', 'Shop approvals'], ['identity', 'ID verification'], ['reports', 'Reports'], ['coupons', 'Promotions'], ['activity', 'Activity trail'],
]

function AdminPage({ user, token, onLogout }) {
  const [section, setSection] = useState('overview')
  const [overview, setOverview] = useState({ users: 0, activeUsers: 0, products: 0, pendingShops: 0, roles: [], categories: [] })
  const [users, setUsers] = useState([])
  const [products, setProducts] = useState([])
  const [shops, setShops] = useState([])
  const [rentalRequests, setRentalRequests] = useState([])
  const [auditEvents, setAuditEvents] = useState([])
  const [coupons, setCoupons] = useState([])
  const [identityUsers, setIdentityUsers] = useState([])
  const [photos, setPhotos] = useState([])
  const [editingProduct, setEditingProduct] = useState(null)
  const [productSearch, setProductSearch] = useState('')
  const [productStatus, setProductStatus] = useState('all')
  const [userSearch, setUserSearch] = useState('')
  const [userRole, setUserRole] = useState('all')
  const [userStatus, setUserStatus] = useState('all')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    })
    return readJsonResponse(response)
  }

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [summary, userList, productList, shopList, rentalList, auditList, couponList, identityList] = await Promise.all([
          api('/api/admin/overview'), api('/api/admin/users'), api('/api/admin/products'), api('/api/admin/shops/pending'), api('/api/provider/requests'), api('/api/admin/audit'), api('/api/admin/coupons'), api('/api/admin/identity/pending'),
        ])
        if (cancelled) return
        setOverview(summary)
        setUsers(userList.users)
        setProducts(productList.products)
        setShops(shopList.shops)
        setRentalRequests(rentalList.requests || [])
        setAuditEvents(auditList.events || [])
        setCoupons(couponList.coupons || [])
        setIdentityUsers(identityList.users || [])
      } catch (loadError) {
        if (!cancelled) setError(loadError.message)
      }
    }
    load()
    return () => { cancelled = true }
  }, [token, reload])

  const runAction = async (action, success) => {
    setError('')
    setMessage('')
    setBusy(true)
    try {
      await action()
      setMessage(success)
      setReload((value) => value + 1)
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy(false)
    }
  }

  const handlePhotos = async (event) => {
    const files = Array.from(event.target.files || [])
    setError('')
    if (files.length > 6) {
      setError('Choose up to 6 photos.')
      event.target.value = ''
      return
    }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2.5 * 1024 * 1024)) {
      setError('Use JPEG, PNG, or WebP photos smaller than 2.5 MB each.')
      event.target.value = ''
      return
    }
    try {
      const encoded = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name, data: reader.result })
        reader.onerror = reject
        reader.readAsDataURL(file)
      })))
      setPhotos(encoded)
    } catch {
      setError('Could not read one of those photos.')
    }
  }

  const submitProduct = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    await runAction(async () => {
      await api('/api/admin/products', { method: 'POST', body: JSON.stringify({
        title: form.get('title'), category: form.get('category'), description: form.get('description'), dailyRate: form.get('dailyRate'), leadTimeHours: form.get('leadTimeHours'), providerId: form.get('providerId'), photos: photos.map((photo) => photo.data),
      }) })
      formElement.reset()
      setPhotos([])
    }, 'Product published in Batticaloa.')
  }

  const submitUser = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    await runAction(async () => {
      await api('/api/admin/users', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) })
      formElement.reset()
    }, 'Account created.')
  }

  const submitCoupon = async (event) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    await runAction(async () => {
      await api('/api/admin/coupons', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) })
      formElement.reset()
    }, 'Coupon created.')
  }

  const updateUser = (id, data) => runAction(() => api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }), 'Account updated.')
  const reviewShop = (id, decision) => runAction(() => api(`/api/admin/shops/${id}/review`, { method: 'PATCH', body: JSON.stringify({ decision }) }), decision === 'approved' ? 'Rental shop approved.' : 'Shop application declined.')
  const reviewIdentity = (id, decision) => runAction(() => api(`/api/admin/identity/${id}/review`, { method: 'PATCH', body: JSON.stringify({ decision }) }), decision === 'approved' ? 'Identity verified.' : 'Identity application declined.')

  const visibleProducts = products.filter((product) => {
    const matchesText = `${product.title} ${product.category} ${product.location}`.toLowerCase().includes(productSearch.toLowerCase())
    return matchesText && (productStatus === 'all' || (productStatus === 'active') === product.active)
  })
  const visibleUsers = users.filter((account) => {
    const matchesText = `${account.username} ${account.email} ${account.phone}`.toLowerCase().includes(userSearch.toLowerCase())
    return matchesText && (userRole === 'all' || account.role === userRole) &&
      (userStatus === 'all' || (userStatus === 'active') === account.active)
  })
  const exportCsv = (filename, rows) => {
    const csv = rows.map((row) => row.map((value) => {
      let cell = String(value ?? '')
      if (/^[=+\-@]/.test(cell)) cell = `'${cell}`
      return `"${cell.replaceAll('"', '""')}"`
    }).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }
  const editProduct = async (event) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    await runAction(async () => {
      await api(`/api/admin/products/${editingProduct._id}`, { method: 'PATCH', body: JSON.stringify({
        title: form.get('title'), category: form.get('category'), description: form.get('description'), dailyRate: form.get('dailyRate'),
      }) })
      setEditingProduct(null)
    }, 'Product details saved.')
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/" aria-label="RentEase admin home"><span className="admin-brand-mark">r</span><span>RentEase <small>ADMIN</small></span></a>
        <div className="admin-side-label">WORKSPACE</div>
        <nav className="admin-nav" aria-label="Admin sections">
          {sections.map(([id, label]) => <button type="button" key={id} className={section === id ? 'active' : ''} onClick={() => { setSection(id); setMessage(''); setError('') }}><span className="admin-nav-dot" />{label}{id === 'shops' && overview.pendingShops > 0 && <b>{overview.pendingShops}</b>}</button>)}
        </nav>
        <div className="admin-side-footer"><div className="admin-user-avatar">{user.username?.[0]?.toUpperCase() || 'A'}</div><span><b>{user.username}</b><small>Administrator</small></span><button type="button" onClick={onLogout} aria-label="Sign out">↗</button></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar"><div><span>RentEase /</span> {sections.find(([id]) => id === section)?.[1]}</div><div className="admin-topbar-actions"><span className="admin-location">⌖ &nbsp;Batticaloa, Sri Lanka</span><button type="button" className="admin-refresh" onClick={() => setReload((value) => value + 1)}>↻ <span>Refresh</span></button></div></header>
        <div className="admin-content">
          <div className="admin-page-heading"><div><span className="admin-kicker">CONTROL CENTER</span><h1>{section === 'overview' ? `Welcome back, ${user.username}.` : sections.find(([id]) => id === section)?.[1]}</h1><p>{section === 'overview' ? 'Manage listings, accounts, and rental shop applications.' : descriptions[section]}</p></div>{section === 'overview' && <button type="button" className="admin-primary" onClick={() => setSection('products')}>+ Add rental listing</button>}</div>
          {error && <div className="admin-alert is-error" role="alert">{error}</div>}
          {message && <div className="admin-alert" role="status">{message}</div>}

          {section === 'overview' && <>
            <div className="admin-stat-grid">
              <Stat label="All accounts" value={overview.users} detail={`${overview.activeUsers} active`} mark="U" />
              <Stat label="Active listings" value={overview.products} detail="Available to rent" mark="P" />
              <Stat label="Shop reviews" value={overview.pendingShops} detail="Awaiting your review" mark="S" />
            </div>
            <div className="admin-overview-grid">
              <section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">LATEST WORK</span><h2>Recently added products</h2></div><button type="button" className="admin-text-button" onClick={() => setSection('products')}>View all →</button></div>
                {products.filter((product) => product.active).length ? <div className="admin-product-list">{products.filter((product) => product.active).slice(0, 4).map((product) => <ProductRow key={product._id} product={product} />)}</div> : <Empty text="No active listings yet. Add your first rental listing." />}
              </section>
              <section className="admin-card admin-approval-card"><div className="admin-kicker">SHOP ONBOARDING</div><h2>{overview.pendingShops ? `${overview.pendingShops} shop${overview.pendingShops === 1 ? '' : 's'} need review` : 'No applications waiting'}</h2><p>Review shop owner details before granting access to the rental tools.</p><button className="admin-primary small" type="button" onClick={() => setSection('shops')}>Review applications <span>→</span></button></section>
            </div>
            <section className="admin-card admin-activity-card"><div className="admin-card-heading"><div><span className="admin-kicker">LAST 7 DAYS</span><h2>New accounts and listings</h2></div><span className="admin-count">Daily activity</span></div><ActivityChart activity={overview.activity} /></section>
          </>}

          {section === 'products' && <div className="admin-work-grid">
            <section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">NEW LISTING</span><h2>Add a product for rent</h2></div></div>
              <form className="admin-form" onSubmit={submitProduct}>
                <label>Product name<input name="title" placeholder="e.g. Heavy duty rotary hammer" maxLength="120" required /></label>
                <div className="admin-form-row"><label>Category<select name="category" required defaultValue=""><option value="" disabled>Select category</option>{['Tools & equipment', 'Construction', 'Vehicles', 'Electronics', 'Home & garden', 'Events & spaces', 'Other'].map((category) => <option key={category}>{category}</option>)}</select></label><label>Daily rental rate (LKR)<input name="dailyRate" type="number" min="0" step="1" placeholder="2500" required /></label></div>
                <label>Preparation and delivery lead time (hours)<input name="leadTimeHours" type="number" min="0" max="720" step="1" defaultValue="24" required /></label>
                <label>Description<textarea name="description" rows="4" maxLength="3000" placeholder="Describe the item, condition, and what's included." required /></label>
                <label>Rental provider<select name="providerId" defaultValue=""><option value="">RentEase admin (default)</option>{users.filter((account) => account.role === 'rental_shop' && account.active && account.shopStatus === 'approved').map((shop) => <option key={shop._id} value={shop._id}>{shop.shopName || shop.username}</option>)}</select></label>
                <div className="admin-fixed-location"><span>⌖</span><div><b>Rental location</b><small>Batticaloa, Sri Lanka · default location</small></div><strong>DEFAULT</strong></div>
                <label className="admin-upload-label">Product photos <small>Choose 1 to 6 · JPEG, PNG, WebP · up to 2.5 MB each</small><input className="admin-file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handlePhotos} /></label>
                {!!photos.length && <div className="admin-photo-previews">{photos.map((photo, index) => <div key={`${photo.name}-${index}`}><img src={photo.data} alt={photo.name} /><button type="button" onClick={() => setPhotos((items) => items.filter((_, photoIndex) => photoIndex !== index))} aria-label={`Remove ${photo.name}`}>×</button></div>)}</div>}
                <button className="admin-primary" type="submit" disabled={busy || !photos.length}>{busy ? 'Publishing…' : 'Publish rental listing'} <span>↗</span></button>
              </form>
            </section>
            <section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">INVENTORY</span><h2>{products.filter((product) => product.active).length} active listing{products.filter((product) => product.active).length === 1 ? '' : 's'}</h2></div><button type="button" className="admin-text-button" onClick={() => exportCsv('rentease-products.csv', [['Product', 'Category', 'Daily rate LKR', 'Location', 'Status'], ...products.map((item) => [item.title, item.category, item.dailyRate, item.location, item.active ? 'Active' : 'Inactive'])])}>Export CSV</button></div>
              <div className="admin-toolbar"><input aria-label="Search listings" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search listings…" /><select aria-label="Filter listings by status" value={productStatus} onChange={(event) => setProductStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
              {visibleProducts.length ? <div className="admin-product-list">{visibleProducts.map((product) => <ProductRow key={product._id} product={product} onEdit={() => setEditingProduct(product)} onToggle={() => runAction(() => api(`/api/admin/products/${product._id}`, { method: 'PATCH', body: JSON.stringify({ active: !product.active }) }), product.active ? 'Listing deactivated.' : 'Listing activated.')} />)}</div> : <Empty text={products.length ? 'No listings match those filters.' : 'Your published rentals will appear here.'} />}
            </section>
          </div>}

          {section === 'requests' && <section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">PROVIDER WORKFLOW</span><h2>Customer rental requests</h2><p className="admin-card-subtitle">Requests for listings assigned to RentEase admin can be accepted or declined here.</p></div><span className="admin-count">{rentalRequests.length} requests</span></div>{rentalRequests.length ? <div className="admin-product-list">{rentalRequests.map((request) => <article className="admin-shop-row" key={request._id}><div className="admin-shop-info"><h3>{request.items.map((item) => item.title).join(', ')}</h3><p>{request.customerId?.username} · {request.customerId?.email} · {new Date(request.startDate).toLocaleDateString()} – {new Date(request.endDate).toLocaleDateString()}</p><small>{request.deliveryMethod === 'partner' ? `Partner delivery · ${request.distanceKm.toFixed(1)} km · ${request.etaMinutes} min estimate` : 'Customer pickup'} · {Number(request.total).toLocaleString()} LKR</small><div className="admin-shop-actions">{request.items.filter((item) => item.decision === 'pending' && String(item.providerId) === String(user.id || user._id)).map((item) => <span key={item.productId}><b>{item.title}</b> <button className="admin-secondary" type="button" disabled={busy} onClick={() => runAction(() => api(`/api/provider/requests/${request._id}/items/${item.productId}`, { method: 'PATCH', body: JSON.stringify({ decision: 'rejected' }) }), 'Request declined.')}>Decline</button> <button className="admin-primary small" type="button" disabled={busy} onClick={() => runAction(() => api(`/api/provider/requests/${request._id}/items/${item.productId}`, { method: 'PATCH', body: JSON.stringify({ decision: 'accepted' }) }), 'Request accepted.')}>Accept</button></span>)}</div></div></article>)}</div> : <Empty text="There are no customer requests for admin-managed listings." />}</section>}

          {section === 'users' && <div className="admin-work-grid">
            <section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">CREATE ACCOUNT</span><h2>Add a platform user</h2></div></div>
              <form className="admin-form" onSubmit={submitUser}><label>Full name<input name="username" required placeholder="Name" /></label><label>Email<input name="email" type="email" required placeholder="person@example.com" /></label><label>Phone<input name="phone" type="tel" required placeholder="Phone number" /></label><label>Temporary password<input name="password" type="password" minLength="10" required placeholder="At least 10 characters" /></label><label>Account type<select name="role" defaultValue="user"><option value="user">Customer</option><option value="delivery_partner">Delivery partner</option><option value="rental_shop">Rental shop owner</option></select></label><label>Shop name <small>Optional for other account types</small><input name="shopName" placeholder="Rental shop name" /></label><button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'} <span>↗</span></button><p className="admin-form-hint">Rental shop accounts created by an admin are approved immediately.</p></form>
            </section>
            <section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">DIRECTORY</span><h2>Manage accounts</h2></div><div className="admin-heading-actions"><button type="button" className="admin-text-button" onClick={() => exportCsv('rentease-users.csv', [['Name', 'Email', 'Phone', 'Role', 'Status'], ...users.map((item) => [item.username, item.email, item.phone, roleLabels[item.role] || item.role, item.active ? 'Active' : 'Suspended'])])}>Export CSV</button><span className="admin-count">{visibleUsers.length} of {users.length}</span></div></div>
              <div className="admin-toolbar"><input aria-label="Search users" value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Search name, email, phone…" /><select aria-label="Filter users by role" value={userRole} onChange={(event) => setUserRole(event.target.value)}><option value="all">All roles</option><option value="user">Customers</option><option value="delivery_partner">Delivery partners</option><option value="rental_shop">Rental shops</option><option value="admin">Admins</option></select><select aria-label="Filter users by status" value={userStatus} onChange={(event) => setUserStatus(event.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Suspended</option></select></div>
              <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Account</th><th>Role</th><th>Status</th><th>Action</th></tr></thead><tbody>{visibleUsers.map((account) => <tr key={account._id}><td><b>{account.username}</b><small>{account.email}</small></td><td><select aria-label={`Role for ${account.username}`} value={account.role === 'admin' ? 'admin' : account.role} disabled={account.role === 'admin' || account._id === user.id} onChange={(event) => updateUser(account._id, { role: event.target.value })}><option value="user">Customer</option><option value="delivery_partner">Delivery partner</option><option value="rental_shop">Rental shop</option>{account.role === 'admin' && <option value="admin">Admin</option>}</select></td><td><span className={`admin-status ${account.active ? 'is-active' : 'is-paused'}`}>{account.active ? 'Active' : 'Suspended'}</span></td><td>{account.role === 'admin' ? <small>Protected</small> : <button className="admin-row-action" type="button" disabled={busy || account._id === user.id} onClick={() => updateUser(account._id, { active: !account.active })}>{account.active ? 'Suspend' : 'Restore'}</button>}</td></tr>)}</tbody></table>{!visibleUsers.length && <Empty text="No accounts match those filters." />}</div>
            </section>
          </div>}

          {section === 'shops' && <section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">VERIFICATION QUEUE</span><h2>Rental shop applications</h2><p className="admin-card-subtitle">Approved shop owners can sign in and use the platform.</p></div><span className="admin-count">{shops.length} pending</span></div>
            {shops.length ? <div className="admin-shop-list">{shops.map((shop) => <article className="admin-shop-row" key={shop._id}><div className="admin-shop-avatar">{shop.shopName?.[0]?.toUpperCase() || 'S'}</div><div className="admin-shop-info"><h3>{shop.shopName}</h3><p>{shop.username} · {shop.email} · {shop.phone}</p><small>Applied {new Date(shop.createdAt).toLocaleDateString()}</small></div><div className="admin-shop-actions"><button type="button" className="admin-secondary" disabled={busy} onClick={() => reviewShop(shop._id, 'rejected')}>Decline</button><button type="button" className="admin-primary small" disabled={busy} onClick={() => reviewShop(shop._id, 'approved')}>Approve</button></div></article>)}</div> : <Empty text="There are no rental shop applications waiting for review." />}
          </section>}

          {section === 'reports' && <>
            <div className="admin-report-actions"><button type="button" className="admin-secondary" onClick={() => exportCsv('rentease-users.csv', [['Name', 'Email', 'Phone', 'Role', 'Status'], ...users.map((item) => [item.username, item.email, item.phone, roleLabels[item.role] || item.role, item.active ? 'Active' : 'Suspended'])])}>Download user report</button><button type="button" className="admin-secondary" onClick={() => exportCsv('rentease-products.csv', [['Product', 'Category', 'Daily rate LKR', 'Location', 'Status'], ...products.map((item) => [item.title, item.category, item.dailyRate, item.location, item.active ? 'Active' : 'Inactive'])])}>Download listing report</button></div>
            <div className="admin-stat-grid"><Stat label="Registered accounts" value={overview.users} detail={`${overview.activeUsers} active accounts`} mark="U" /><Stat label="Published rentals" value={overview.products} detail="Active product listings" mark="P" /><Stat label="Pending verification" value={overview.pendingShops} detail="Rental shop applications" mark="✓" /></div>
            <div className="admin-overview-grid"><section className="admin-card"><div className="admin-kicker">ACCOUNT MIX</div><h2>Users by account type</h2>{overview.roles.length ? <div className="admin-report-list">{overview.roles.map((item) => <div key={item._id}><span>{roleLabels[item._id] || item._id}</span><b>{item.count}</b><i style={{ '--bar-width': `${overview.users ? Math.max(4, (item.count / overview.users) * 100) : 0}%` }} /></div>)}</div> : <Empty text="Account data will show here." />}</section>
              <section className="admin-card"><div className="admin-kicker">RENTAL CATALOG</div><h2>Listings by category</h2>{overview.categories.length ? <div className="admin-report-list">{overview.categories.map((item) => <div key={item._id}><span>{item._id}</span><b>{item.count}</b><i style={{ '--bar-width': `${overview.products ? Math.max(4, (item.count / overview.products) * 100) : 0}%` }} /></div>)}</div> : <Empty text="Publish products to see category reports." />}</section></div>
          </>}

          {section === 'coupons' && <div className="admin-work-grid"><section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">PROMOTION SETUP</span><h2>Create a coupon</h2></div></div><form className="admin-form" onSubmit={submitCoupon}><label>Coupon code<input name="code" required maxLength="32" placeholder="WELCOME10" /></label><div className="admin-form-row"><label>Discount type<select name="kind" defaultValue="percent"><option value="percent">Percentage</option><option value="fixed">Fixed LKR amount</option></select></label><label>Discount value<input name="value" type="number" min="1" step="1" required placeholder="10" /></label></div><label>Minimum rental subtotal (LKR)<input name="minimumSubtotal" type="number" min="0" step="1" defaultValue="0" /></label><div className="admin-form-row"><label>Maximum discount (optional)<input name="maximumDiscount" type="number" min="0" step="1" placeholder="No cap" /></label><label>Redemption limit (optional)<input name="maxRedemptions" type="number" min="1" step="1" placeholder="Unlimited" /></label></div><label>Expiry date (optional)<input name="expiresAt" type="date" /></label><button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create coupon'}</button></form></section><section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">ACTIVE PROMOTIONS</span><h2>Coupon codes</h2></div><span className="admin-count">{coupons.length} total</span></div>{coupons.length ? <div className="admin-product-list">{coupons.map((coupon) => <article className="admin-coupon-row" key={coupon._id}><div><b>{coupon.code}</b><small>{coupon.kind === 'percent' ? `${coupon.value}% off` : `LKR ${Number(coupon.value).toLocaleString()} off`} · min. LKR {Number(coupon.minimumSubtotal || 0).toLocaleString()}</small><small>{coupon.redemptionCount} used{coupon.maxRedemptions ? ` of ${coupon.maxRedemptions}` : ''}{coupon.expiresAt ? ` · expires ${new Date(coupon.expiresAt).toLocaleDateString()}` : ''}</small></div><span className={`admin-status ${coupon.active ? 'is-active' : 'is-paused'}`}>{coupon.active ? 'Active' : 'Paused'}</span><button className="admin-row-action" type="button" disabled={busy} onClick={() => runAction(() => api(`/api/admin/coupons/${coupon._id}`, { method: 'PATCH', body: JSON.stringify({ active: !coupon.active }) }), coupon.active ? 'Coupon paused.' : 'Coupon activated.')}>{coupon.active ? 'Pause' : 'Activate'}</button></article>)}</div> : <Empty text="Create a coupon to launch a promotion." />}</section></div>}

          {section === 'identity' && <section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">IDENTITY REVIEW</span><h2>Customer verification queue</h2><p className="admin-card-subtitle">Review both sides of an ID before approving the customer's identity.</p></div><span className="admin-count">{identityUsers.length} pending</span></div>{identityUsers.length ? <div className="admin-identity-list">{identityUsers.map((account) => <IdentityReviewCard key={account._id} account={account} token={token} busy={busy} onReview={reviewIdentity} />)}</div> : <Empty text="There are no identity applications waiting for review." />}</section>}

          {section === 'activity' && <section className="admin-card"><div className="admin-card-heading"><div><span className="admin-kicker">ADMIN AUDIT TRAIL</span><h2>Recent platform actions</h2><p className="admin-card-subtitle">Account, listing, booking, and delivery changes with their actor and time.</p></div><span className="admin-count">{auditEvents.length} events</span></div>{auditEvents.length ? <div className="admin-audit-list">{auditEvents.map((event) => <article key={event._id}><span className="admin-audit-mark">{event.actorRole === 'admin' ? 'A' : event.actorRole === 'rental_shop' ? 'S' : event.actorRole === 'delivery_partner' ? 'D' : 'U'}</span><div><b>{event.summary}</b><p>{event.actorId?.username || 'Former account'} · {event.actorRole} · {event.action}</p></div><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></article>)}</div> : <Empty text="Platform actions will appear here as users work." />}</section>}
        </div>
      </section>
      {editingProduct && <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditingProduct(null) }}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="edit-product-title"><div className="admin-card-heading"><div><span className="admin-kicker">LISTING DETAILS</span><h2 id="edit-product-title">Edit product</h2></div><button type="button" className="admin-modal-close" aria-label="Close" onClick={() => setEditingProduct(null)}>×</button></div><form className="admin-form" onSubmit={editProduct}><label>Product name<input name="title" defaultValue={editingProduct.title} maxLength="120" required /></label><label>Category<input name="category" defaultValue={editingProduct.category} maxLength="80" required /></label><label>Daily rental rate (LKR)<input name="dailyRate" type="number" min="0" step="1" defaultValue={editingProduct.dailyRate} required /></label><label>Description<textarea name="description" rows="5" defaultValue={editingProduct.description} maxLength="3000" required /></label><div className="admin-modal-actions"><button type="button" className="admin-secondary" onClick={() => setEditingProduct(null)}>Cancel</button><button className="admin-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div></form></section></div>}
    </main>
  )
}

const descriptions = { products: 'Create and maintain the rental inventory.', requests: 'Review customer requests for admin-managed listings.', users: 'Create accounts and control platform access.', shops: 'Verify rental shops before activating their accounts.', reports: 'Review account and listing activity across RentEase.', coupons: 'Set up and monitor customer promotion codes.', activity: 'Inspect recent administrative and operational changes.' }
const roleLabels = { user: 'Customers', delivery_partner: 'Delivery partners', rental_shop: 'Rental shops', admin: 'Administrators' }

function Stat({ label, value, detail, mark }) {
  return <article className="admin-stat"><span className="admin-stat-mark">{mark}</span><div><small>{label}</small><strong>{value}</strong><span>{detail}</span></div></article>
}

function IdentityReviewCard({ account, token, busy, onReview }) {
  const [documents, setDocuments] = useState({ front: '', back: '' })
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let objectUrls = []
    Promise.all(['front', 'back'].map(async (side) => {
      const response = await fetch(`/api/admin/identity/${account._id}/${side}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!response.ok) throw new Error('Could not load one of the ID images.')
      const url = URL.createObjectURL(await response.blob())
      objectUrls.push(url)
      return [side, url]
    })).then((entries) => { if (active) setDocuments(Object.fromEntries(entries)) }).catch((loadError) => { if (active) setError(loadError.message) })
    return () => { active = false; objectUrls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [account._id, token])
  return <article className="admin-identity-row"><div className="admin-identity-copy"><h3>{account.username}</h3><p>{account.email} · {account.phone} · NIC {account.nic || 'not provided'}</p><small>Submitted {new Date(account.identitySubmittedAt).toLocaleString()}</small><div className="admin-identity-images">{documents.front ? <a href={documents.front} target="_blank" rel="noreferrer"><img src={documents.front} alt={`${account.username} ID front`} /><span>Front</span></a> : <span>Loading front…</span>}{documents.back ? <a href={documents.back} target="_blank" rel="noreferrer"><img src={documents.back} alt={`${account.username} ID back`} /><span>Back</span></a> : <span>Loading back…</span>}</div>{error && <small className="admin-identity-error">{error}</small>}</div><div className="admin-shop-actions"><button className="admin-secondary" type="button" disabled={busy} onClick={() => onReview(account._id, 'rejected')}>Decline</button><button className="admin-primary small" type="button" disabled={busy} onClick={() => onReview(account._id, 'approved')}>Verify</button></div></article>
}

function ProductRow({ product, onEdit, onToggle }) {
  return <article className="admin-product-row"><img src={product.photos?.[0]} alt="" /><div className="admin-product-info"><b>{product.title}</b><span>{product.category} · {product.location}</span><small>LKR {Number(product.dailyRate).toLocaleString()} / day <span className={`admin-status ${product.active ? 'is-active' : 'is-paused'}`}>{product.active ? 'Active' : 'Inactive'}</span></small></div>{onEdit && <button className="admin-row-action" type="button" onClick={onEdit}>Edit</button>}{onToggle && <button className="admin-row-action" type="button" onClick={onToggle}>{product.active ? 'Deactivate' : 'Activate'}</button>}</article>
}

function ActivityChart({ activity = {} }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (6 - index))
    const key = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
    return { key, label: date.toLocaleDateString('en', { weekday: 'short', timeZone: 'Asia/Colombo' }) }
  })
  const users = Object.fromEntries((activity.users || []).map((item) => [item._id, item.count]))
  const products = Object.fromEntries((activity.products || []).map((item) => [item._id, item.count]))
  const max = Math.max(1, ...days.flatMap(({ key }) => [users[key] || 0, products[key] || 0]))
  return <div className="admin-activity-chart"><div className="admin-chart-legend"><span><i className="users" />New accounts</span><span><i className="products" />New listings</span></div><div className="admin-chart-bars">{days.map(({ key, label }) => <div className="admin-chart-day" key={key}><div className="admin-chart-pair"><i className="users" style={{ height: `${Math.max(3, (users[key] || 0) / max * 100)}%` }} title={`${users[key] || 0} accounts`} /><i className="products" style={{ height: `${Math.max(3, (products[key] || 0) / max * 100)}%` }} title={`${products[key] || 0} listings`} /></div><span>{label}</span></div>)}</div></div>
}

function Empty({ text }) { return <div className="admin-empty">{text}</div> }

export default AdminPage
