import DeliveryTaskBoard from '../../delivery-partner/components/DeliveryTaskBoard.jsx'
import RentalHandover from '../../rentals/pages/RentalHandover.jsx'
import ShopOverview from '../components/ShopOverview.jsx'
import ShopInventory from '../components/ShopInventory.jsx'
import AddListingDialog from '../components/AddListingDialog.jsx'
import ShopBookings from '../components/ShopBookings.jsx'
import ShopReviews from '../components/ShopReviews.jsx'
import EditListingPhotos from '../components/EditListingPhotos.jsx'

import AvailabilityCalendar from '../components/AvailabilityCalendar.jsx'
import { useCallback, useEffect, useMemo, useState } from 'react'
import '../../../layouts/workspace.css'
import { BrandMark } from '../../../components/ui/BrandMark.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { WorkspaceNav } from '../../../components/ui/WorkspaceNav.jsx'
import { ShopLocation } from '../../maps/components/ShopLocation.jsx'
import { DeliveryWorkspace } from '../../maps/components/DeliveryWorkspace.jsx'
import RentalDecisionDialog from '../../rentals/components/RentalDecisionDialog.jsx'
import useProviderRequests from '../../rentals/hooks/useProviderRequests.js'
import NotificationBell from '../../notifications/components/NotificationBell.jsx'
import NotificationCenter from '../../notifications/pages/NotificationCenter.jsx'
import CommissionPanel from '../../payments/components/CommissionPanel.jsx'
import { useNotificationCount } from '../../notifications/hooks/useNotificationCount.js'
import WorkspaceAccountMenu from '../../../components/account/WorkspaceAccountMenu.jsx'
import ChatPanel from '../../chat/components/ChatPanel.jsx'
import WorkspaceFooter from '../../../components/layout/WorkspaceFooter.jsx'
import useConversations from '../../chat/hooks/useConversations.js'

// Review notifications open the reviews page; everything else concerns a booking.
const notificationSection = (row) => (/review/i.test(row?.title || '') ? 'reviews' : 'bookings')

export default function OwnerHome({ user, api, token, onLogout, onAccountUpdate }) {
  const unread = useNotificationCount(api)
  const chats = useConversations(api)
  const [section, setSection] = useState('overview')
  const [decisionTarget, setDecisionTarget] = useState(null)
  const [calendarMonth, setCalendarMonth] = useState(() => new Date())
  const [calendarProduct, setCalendarProduct] = useState('all')
  const [products, setProducts] = useState([])
  const {
    requests,
    loading: requestsLoading,
    error: requestsError,
    refresh: refreshRequests,
  } = useProviderRequests(api)
  const [photos, setPhotos] = useState([])
  const [photoProduct, setPhotoProduct] = useState(null)
  const [addListingOpen, setAddListingOpen] = useState(false)
  const [addListingError, setAddListingError] = useState('')

  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const inventory = await api('/api/owner/products')
      setProducts(inventory.products || [])
    } catch (loadError) {
      setError(loadError.message)
    }
  }, [api])
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) load()
    })
    return () => {
      active = false
    }
  }, [load])

  const visibleProducts = useMemo(
    () =>
      products.filter((product) =>
        `${product.title} ${product.category}`.toLowerCase().includes(search.toLowerCase()),
      ),
    [products, search],
  )
  const pending = requests
    .filter((request) => ['pending', 'confirmed'].includes(request.status))
    .reduce(
      (sum, request) => sum + request.items.filter((item) => item.decision === 'pending').length,
      0,
    )
  const accepted = requests.flatMap((request) =>
    request.items.filter((item) => item.decision === 'accepted'),
  )
  // Only paid, live bookings count as value; cancelled and unpaid ones never reach the shop.
  const paidStatuses = ['authorized', 'paid', 'partially_refunded', 'refunded']
  const bookedValue = requests
    .filter((request) => request.status !== 'cancelled' && paidStatuses.includes(request.payment?.status))
    .flatMap((request) => request.items.filter((item) => item.decision === 'accepted'))
    .reduce((sum, item) => sum + Number(item.rentalAmount || 0), 0)

  const closeAddListing = () => {
    setAddListingOpen(false)
    setAddListingError('')
    setPhotos([])
  }
  // Vehicle or asset details become the listing's first specifications, as on the admin form.
  const submitListing = async (event, itemType) => {
    event.preventDefault()
    setBusy(true)
    setAddListingError('')
    setNotice('')
    const form = new FormData(event.currentTarget)
    const vehicle = itemType === 'vehicle'
    const details = vehicle
      ? [
          ['Make', form.get('make')],
          ['Model', form.get('model')],
          ['Registration number', form.get('registration')],
          ['Fuel type', form.get('fuelType')],
          ['Seats', form.get('seats')],
        ]
      : [
          ['Brand / model', form.get('brandModel')],
          ['Condition', form.get('condition')],
          ['Asset ID', form.get('assetId')],
        ]
    const extra = String(form.get('specifications') || '')
      .split('\n')
      .map((line) => {
        const [name, ...parts] = line.split(':')
        return [name, parts.join(':')]
      })
    const specifications = [['Item type', vehicle ? 'Vehicle' : 'Asset'], ...details, ...extra]
      .map(([name, value]) => ({ name: String(name || '').trim(), value: String(value || '').trim() }))
      .filter((row) => row.name && row.value)
    try {
      const result = await api('/api/owner/products', {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          category: vehicle ? 'Vehicles' : form.get('category'),
          description: form.get('description'),
          dailyRate: Number(form.get('dailyRate')),
          hourlyRate: form.get('hourlyRate'),
          weeklyRate: form.get('weeklyRate'),
          longRentalDiscountPercent: Number(form.get('longRentalDiscountPercent') || 0),
          depositAmount: Number(form.get('depositAmount') || 0),
          leadTimeHours: Number(form.get('leadTimeHours')),
          specifications,
          photos: photos.map((photo) => photo.data),
        }),
      })
      setNotice(result.message)
      closeAddListing()
      await load()
      setSection('inventory')
    } catch (submitError) {
      setAddListingError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  // Both decisions open a dialog: accepting asks for the account password, declining for a reason.
  const decide = (requestId, productId, decision) => {
    const title = requests
      .find((request) => request._id === requestId)
      ?.items.find((item) => item.productId === productId)?.title
    setDecisionTarget({ requestId, productId, decision, title })
  }
  const toggleProduct = async (product) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api(`/api/owner/products/${product._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !product.active }),
      })
      setNotice(result.message)
      await load()
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="business-shell">
      <aside className="business-sidebar">
        <a className="business-brand" href="/">
          <BrandMark />
          RentEase <small>BUSINESS</small>
        </a>
        <div className="business-shop-card">
          <div className="business-avatar">
            {(user.shopName || user.username || 'S')[0].toUpperCase()}
          </div>
          <div>
            <b>{user.shopName || user.username}</b>
            <small>Rental shop</small>
          </div>
          <i>Verified</i>
        </div>
        <WorkspaceNav
          onLogout={onLogout}
          className="business-menu"
          label="Owner workspace"
          active={section}
          items={[
            { id: 'overview', label: 'Overview' },
            { id: 'inventory', label: 'Inventory' },
            { id: 'calendar', label: 'Availability' },
            { id: 'bookings', label: 'Bookings', badge: pending },
            { id: 'reviews', label: 'Reviews' },
            { id: 'handovers', label: 'Self-pickup handovers' },
            { id: 'locations', label: 'Maps & delivery' },
            { id: 'earnings', label: 'Earnings' },
            { id: 'inbox', label: 'Notifications', badge: unread },
          ]}
          onSelect={(key) => {
            setSection(key)
            if (key === 'bookings') refreshRequests()
          }}
        />
        <div className="business-sidebar-foot">
          <div>
            <span className="online-dot" />
            Your shop is live
          </div>
          <button onClick={onLogout}>
            <UiIcon name="logout" size={17} />
            Sign out
          </button>
        </div>
      </aside>
      <section className="business-main">
        <header className="business-topbar owner-topbar">
          <div>
            <h1>
              {{
                overview: 'Overview',
                inventory: 'Your inventory',
                locations: 'Shop location & deliveries',
                calendar: 'Availability calendar',
                bookings: 'Booking requests',
                messages: 'Customer messages',
                reviews: 'Customer reviews',
                handovers: 'Self-pickup handovers',
                earnings: 'Earnings',
                inbox: 'Notifications',
              }[section] || 'Overview'}
            </h1>
          </div>
          <div className="business-top-actions">
            <NotificationBell api={api} unreadCount={unread} onHistory={() => setSection('inbox')} onNavigate={(_target, row) => setSection(notificationSection(row))} />
            <div>
              <button
                type="button"
                className={`market-icon-button${section === 'messages' ? ' active' : ''}`}
                aria-label={`Messages${chats.unread ? `, ${chats.unread} unread` : ''}`}
                title="Messages"
                onClick={() => setSection('messages')}
              >
                <UiIcon name="chat" size={20} />
                {chats.unread > 0 && (
                  <b className="inbox-count">{chats.unread > 99 ? '99+' : chats.unread}</b>
                )}
              </button>
            </div>
            <button
              onClick={() => Promise.all([load(), refreshRequests()])}
              aria-label="Refresh workspace"
            >
              <UiIcon name="refresh" size={17} />
            </button>
            <WorkspaceAccountMenu user={user} api={api} onLogout={onLogout} onAccountUpdate={onAccountUpdate} />
          </div>
        </header>
        {error && (
          <div className="workspace-alert is-error" role="alert">
            {error}
          </div>
        )}
        {requestsError && (
          <div className="workspace-alert is-error" role="alert">
            {requestsError}
            <button type="button" onClick={refreshRequests}>
              Retry requests
            </button>
          </div>
        )}
        {requestsLoading && <p role="status">Loading booking requests…</p>}
        {notice && (
          <div className="workspace-alert" role="status">
            {notice}
          </div>
        )}
        {['overview', 'bookings', 'locations'].includes(section) && (
          <DeliveryTaskBoard api={api} role="rental_shop" hideWhenEmpty={section !== 'locations'} />
        )}
        {section === 'handovers' && <RentalHandover token={token} />}
        {section === 'locations' && (
          <>
            <ShopLocation api={api} />
            <DeliveryWorkspace api={api} role="rental_shop" />
          </>
        )}
        {section === 'overview' && (
          <ShopOverview
            accepted={accepted}
            bookedValue={bookedValue}
            busy={busy}
            decide={decide}
            pending={pending}
            products={products}
            requests={requests}
            setSection={setSection}
          />
        )}
        {section === 'inventory' && (
          <ShopInventory
            busy={busy}
            search={search}
            setSearch={setSearch}
            onAddListing={() => setAddListingOpen(true)}
            toggleProduct={toggleProduct}
            editPhotos={setPhotoProduct}
            visibleProducts={visibleProducts}
          />
        )}
        {section === 'calendar' && (
          <AvailabilityCalendar
            products={products}
            month={calendarMonth}
            setMonth={setCalendarMonth}
            productId={calendarProduct}
            setProductId={setCalendarProduct}
          />
        )}
        {section === 'bookings' && (
          <ShopBookings
            busy={busy}
            decide={decide}
            requests={requests}
            onChat={(request) => {
              setSection('messages')
              chats.startChat({ requestId: request._id })
            }}
          />
        )}
        {section === 'messages' && <ChatPanel api={api} chats={chats} side="shop" />}
        {section === 'earnings' && <CommissionPanel api={api} role="rental_shop" />}
        {section === 'reviews' && <ShopReviews api={api} />}
        {section === 'inbox' && <NotificationCenter api={api} onNavigate={(_target, row) => setSection(notificationSection(row))} />}
      </section>
      <WorkspaceFooter />
      {addListingOpen && (
        <AddListingDialog
          busy={busy}
          error={addListingError}
          photos={photos}
          setPhotos={setPhotos}
          submitListing={submitListing}
          onClose={closeAddListing}
        />
      )}
      {photoProduct && <EditListingPhotos key={photoProduct._id} product={photoProduct} api={api} onClose={() => setPhotoProduct(null)} onSaved={() => { setPhotoProduct(null); setNotice('Product photos updated.'); load() }} />}
      {decisionTarget && (
        <RentalDecisionDialog
          target={decisionTarget}
          api={api}
          onClose={() => setDecisionTarget(null)}
          onDecided={async (message) => {
            setDecisionTarget(null)
            setNotice(message)
            await Promise.all([load(), refreshRequests()])
          }}
        />
      )}
    </main>
  )
}
