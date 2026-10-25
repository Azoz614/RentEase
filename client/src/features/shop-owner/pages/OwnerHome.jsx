import DeliveryTaskBoard from '../../delivery-partner/components/DeliveryTaskBoard.jsx'
import RentalHandover from '../../rentals/pages/RentalHandover.jsx'
import ShopOverview from '../components/ShopOverview.jsx'
import ShopInventory from '../components/ShopInventory.jsx'
import CreateListingForm from '../components/CreateListingForm.jsx'
import ShopBookings from '../components/ShopBookings.jsx'

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

export default function OwnerHome({ user, api, token, onLogout }) {
  const [section, setSection] = useState('overview')
  const [declineTarget, setDeclineTarget] = useState(null)
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
  const bookedValue = accepted.reduce((sum, item) => sum + Number(item.rentalAmount || 0), 0)

  const submitListing = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const specifications = String(form.get('specifications') || '')
      .split('\n')
      .map((line) => {
        const [name, ...parts] = line.split(':')
        return { name: name.trim(), value: parts.join(':').trim() }
      })
      .filter((row) => row.name && row.value)
    try {
      const result = await api('/api/owner/products', {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          category: form.get('category'),
          description: form.get('description'),
          dailyRate: Number(form.get('dailyRate')),
          hourlyRate: form.get('hourlyRate'),
          weeklyRate: form.get('weeklyRate'),
          longRentalDiscountPercent: Number(form.get('longRentalDiscountPercent') || 0),
          depositAmount: Number(form.get('depositAmount') || 0),
          specifications,
          photos: photos.map((photo) => photo.data),
        }),
      })
      setNotice(result.message)
      setPhotos([])
      formElement.reset()
      await load()
      setSection('inventory')
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setBusy(false)
    }
  }

  const decide = async (requestId, productId, decision) => {
    if (decision === 'rejected') {
      setDeclineTarget({ requestId, productId })
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await api(`/api/provider/requests/${requestId}/items/${productId}`, {
        method: 'PATCH',
        body: JSON.stringify({ decision }),
      })
      setNotice(result.message)
      await Promise.all([load(), refreshRequests()])
    } catch (actionError) {
      setError(actionError.message)
    } finally {
      setBusy(false)
    }
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
            { id: 'add', label: 'Add a listing' },
            { id: 'bookings', label: 'Bookings', badge: pending },
            { id: 'handovers', label: 'Self-pickup handovers' },
            { id: 'locations', label: 'Maps & delivery' },
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
        <header className="business-topbar">
          <div>
            <small>OWNER WORKSPACE / {section.toUpperCase()}</small>
            <h1>
              {section === 'overview'
                ? 'Good business starts here.'
                : section === 'inventory'
                  ? 'Your inventory'
                  : section === 'add'
                    ? 'Create a rental listing'
                    : section === 'locations'
                      ? 'Shop location & deliveries'
                      : section === 'calendar'
                        ? 'Availability calendar'
                        : 'Booking requests'}
            </h1>
          </div>
          <div className="business-top-actions">
            <span className="business-location">{user.shopName || 'Your rental shop'}</span>
            <button
              onClick={() => Promise.all([load(), refreshRequests()])}
              aria-label="Refresh workspace"
            >
              <UiIcon name="refresh" size={17} />
            </button>
            <span className="business-avatar-small">{(user.username || 'S')[0].toUpperCase()}</span>
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
          <DeliveryTaskBoard api={api} role="rental_shop" />
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
            user={user}
          />
        )}
        {section === 'inventory' && (
          <ShopInventory
            busy={busy}
            search={search}
            setSearch={setSearch}
            setSection={setSection}
            toggleProduct={toggleProduct}
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
        {section === 'add' && (
          <CreateListingForm
            busy={busy}
            photos={photos}
            setError={setError}
            setPhotos={setPhotos}
            submitListing={submitListing}
          />
        )}
        {section === 'bookings' && <ShopBookings busy={busy} decide={decide} requests={requests} />}
      </section>
      {declineTarget && (
        <RentalDecisionDialog
          target={declineTarget}
          api={api}
          onClose={() => setDeclineTarget(null)}
          onDecided={async (message) => {
            setDeclineTarget(null)
            setNotice(message)
            await Promise.all([load(), refreshRequests()])
          }}
        />
      )}
    </main>
  )
}
