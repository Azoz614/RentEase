import { useDeliveryRefresh } from '../../delivery-partner/hooks/useDeliveryEvents.js'
import { shortId, filters, isUpcoming, isPast } from '../utils/customerRentalPresentation.js'

import { Symbol } from '../components/Symbol.jsx'
import { RentalCard } from '../components/RentalCard.jsx'
import { ActionDialog } from '../components/ActionDialog.jsx'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import '../styles/customer-rentals.css'
import CustomerRentalDetails from '../components/CustomerRentalDetails.jsx'
import CustomerPickupModal from '../components/CustomerPickup.jsx'
import { customerRentalStatus, preferLatestRental } from '../utils/customerRental.js'

export default function CustomerRentals({
  initialRentals = [],
  products = [],
  user,
  token,
  api,
  onRentalsChange,
  onBrowse,
  onMessages,
}) {
  const [rentals, setRentals] = useState(initialRentals)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedRental, setSelectedRental] = useState(null)
  const [pickupRental, setPickupRental] = useState(null)
  const detailsTrigger = useRef(null)
  const refreshButton = useRef(null)
  const [loading, setLoading] = useState(initialRentals.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [action, setAction] = useState(null)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState('')
  const paymentKeys = useRef(new Map())
  const inFlight = useRef(false)
  const refreshInFlight = useRef(false)
  const loadSequence = useRef(0)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    if (selectedRental || !detailsTrigger.current) return
    if (detailsTrigger.current.isConnected) detailsTrigger.current.focus()
    else refreshButton.current?.focus()
    detailsTrigger.current = null
  }, [selectedRental])
  const viewDetails = (rental, trigger) => {
    detailsTrigger.current = trigger
    setSelectedRental(rental)
  }
  const load = useCallback(
    async ({ signal } = {}) => {
      const sequence = ++loadSequence.current
      try {
        const result = await api('/api/requests', { signal })
        if (signal?.aborted || !mounted.current || sequence !== loadSequence.current) return
        setRentals((current) =>
          (result.requests || []).map((incoming) =>
            preferLatestRental(
              current.find((entry) => entry._id === incoming._id),
              incoming,
            ),
          ),
        )
        onRentalsChange?.(result.requests || [])
        setError('')
      } catch (loadError) {
        if (
          loadError.name !== 'AbortError' &&
          !signal?.aborted &&
          mounted.current &&
          sequence === loadSequence.current
        )
          setError('We couldn’t refresh your rentals. Please try again.')
      } finally {
        if (!signal?.aborted && mounted.current && sequence === loadSequence.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [api, onRentalsChange],
  )

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    queueMicrotask(() => {
      if (!controller.signal.aborted) load({ signal: controller.signal })
    })
    const refreshVisible = async () => {
      if (document.visibilityState === 'hidden' || refreshInFlight.current) return
      refreshInFlight.current = true
      try {
        await load({ signal: controller.signal })
      } finally {
        refreshInFlight.current = false
      }
    }
    const timer = setInterval(refreshVisible, 20_000)
    document.addEventListener('visibilitychange', refreshVisible)
    window.addEventListener('focus', refreshVisible)
    return () => {
      mounted.current = false
      controller.abort()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshVisible)
      window.removeEventListener('focus', refreshVisible)
    }
  }, [load])

  const counts = {
    all: rentals.length,
    upcoming: rentals.filter(isUpcoming).length,
    active: rentals.filter((rental) => ['active', 'return_in_transit'].includes(rental.status))
      .length,
    past: rentals.filter(isPast).length,
  }
  const updateRental = useCallback(
    (updated) =>
      setRentals((current) =>
        current.map((rental) =>
          rental._id === updated._id ? preferLatestRental(rental, updated) : rental,
        ),
      ),
    [],
  )
  const requestReturnCode = async (rental) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(`return-${rental._id}`)
    setError('')
    try {
      const path =
        rental.deliveryWorkflowVersion === 2 && rental.deliveryMethod === 'partner'
          ? `/api/delivery/rentals/${rental._id}/return`
          : `/api/requests/${rental._id}/return/send`
      const result = await api(path, {
        method: 'POST',
        body: '{}',
      })
      if (!mounted.current) return
      setNotice(
        result.message ||
          'A return verification code was sent to your registered email. Give it to an administrator to complete the return.',
      )
      await load()
    } catch (returnFailure) {
      if (mounted.current)
        setError(
          returnFailure.message ||
            'We could not send a return verification code. Please try again.',
        )
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy('')
    }
  }
  const visible = useMemo(
    () =>
      rentals.filter((rental) => {
        const inGroup =
          filter === 'all' ||
          (filter === 'upcoming' && isUpcoming(rental)) ||
          (filter === 'active' && rental.status === 'active') ||
          (filter === 'past' && isPast(rental))
        const inStatus =
          statusFilter === 'all' ||
          statusFilter === rental.status ||
          (statusFilter === 'awaiting_pickup' && customerRentalStatus(rental) === 'Awaiting pickup')
        return (
          inGroup &&
          inStatus &&
          `${shortId(rental._id)} ${rental._id} ${rental.items.map((item) => item.title).join(' ')}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
        )
      }),
    [rentals, filter, search, statusFilter],
  )

  const openAction = (type, rental) => {
    setActionError('')
    setAction({ type, rental })
  }
  const confirmAction = async (reason = '') => {
    if (!action || inFlight.current) return
    inFlight.current = true
    setBusy(action.type)
    setActionError('')
    try {
      const rental = action.rental
      const options = {
        method: 'POST',
        body: JSON.stringify(action.type === 'cancel' ? { reason } : {}),
      }
      if (action.type === 'pay') {
        if (!paymentKeys.current.has(rental._id))
          paymentKeys.current.set(rental._id, crypto.randomUUID())
        options.headers = { 'Idempotency-Key': paymentKeys.current.get(rental._id) }
      }
      const result = await api(
        `/api/requests/${rental._id}/${action.type === 'pay' ? 'payments' : 'cancel'}`,
        options,
      )
      if (!mounted.current) return
      loadSequence.current += 1
      // Only a confirmed server response changes the displayed booking.
      if (result.request)
        setRentals((current) =>
          current.map((entry) => (entry._id === rental._id ? result.request : entry)),
        )
      setNotice(
        result.message ||
          (action.type === 'pay' ? 'Your payment was recorded.' : 'Your booking was cancelled.'),
      )
      setAction(null)
      await load()
    } catch (actionFailure) {
      if (mounted.current)
        setActionError(
          actionFailure.message || 'The request could not be completed. Please try again.',
        )
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy('')
    }
  }

  const downloadInvoice = async (rental) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(`invoice-${rental._id}`)
    setError('')
    try {
      const response = await fetch(`/api/requests/${rental._id}/invoice`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.message || 'Your invoice could not be downloaded. Please try again.')
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `${rental.invoiceNumber}.pdf`
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (downloadError) {
      if (mounted.current)
        setError(downloadError.message || 'Your invoice could not be downloaded. Please try again.')
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy('')
    }
  }

  useDeliveryRefresh(load)
  return (
    <section className="customer-rentals" aria-labelledby="customer-rentals-heading">
      <div className="cr-breadcrumb">
        <button onClick={onBrowse}>Explore rentals</button>
        <span>/</span>
        <span>My rentals</span>
      </div>
      <header className="cr-heading">
        <div>
          <span className="cr-eyebrow">YOUR RENTAL SPACE</span>
          <h1 id="customer-rentals-heading">My rentals.</h1>
          <p>From your first pickup to the final return, we’ll keep you in the loop.</p>
        </div>
        <button
          ref={refreshButton}
          className="cr-button cr-secondary"
          onClick={() => {
            setRefreshing(true)
            load()
          }}
          disabled={refreshing || loading}
        >
          <Symbol name="refresh" />
          {refreshing ? 'Refreshing…' : 'Refresh bookings'}
        </button>
      </header>
      <div className="cr-overview" aria-label="Your rental summary">
        {[
          [counts.upcoming, 'Upcoming rentals', 'calendar'],
          [counts.active, 'Out on rental', 'box'],
          [counts.past, 'Past rentals', 'check'],
        ].map(([count, label, icon]) => (
          <div key={label}>
            <span className="cr-overview-icon">
              <Symbol name={icon} />
            </span>
            <span>
              <strong>{count}</strong>
              <small>{label}</small>
            </span>
          </div>
        ))}
        <p>
          <Symbol name="shield" />
          <span>
            <b>Safer handovers</b>Pickup and return are verified by email.
          </span>
        </p>
      </div>
      <div className="cr-list-toolbar">
        <nav className="cr-filters" aria-label="Filter your rentals">
          {filters.map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
              <span>{counts[key]}</span>
            </button>
          ))}
        </nav>
        <label className="cr-search">
          <Symbol name="search" size={18} />
          <input
            type="search"
            aria-label="Search your rentals"
            placeholder="Search an item or booking ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="cr-status-filter">
          <span className="cr-screen-reader">Rental status</span>
          <select
            aria-label="Rental status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="pending">Under review</option>
            <option value="confirmed">Booked</option>
            <option value="awaiting_pickup">Awaiting pickup</option>
            <option value="active">On rental</option>
            <option value="return_in_transit">Return in transit</option>
            <option value="returned">Returned</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="disputed">Disputed</option>
          </select>
        </label>
      </div>
      {notice && (
        <div className="cr-notice" role="status">
          <Symbol name="check" />
          <span>{notice}</span>
          <button aria-label="Dismiss booking update" onClick={() => setNotice('')}>
            <Symbol name="close" size={17} />
          </button>
        </div>
      )}
      {error && (
        <div className="cr-error" role="alert">
          <span>{error}</span>
          <button
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true)
              load()
            }}
          >
            Refresh rentals
          </button>
        </div>
      )}
      <div className="cr-rental-list" aria-busy={loading}>
        {loading ? (
          <>
            <div className="cr-skeleton" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="cr-skeleton" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <p className="cr-screen-reader" role="status">
              Loading your rentals…
            </p>
          </>
        ) : (
          visible.map((rental) => (
            <RentalCard
              key={rental._id}
              rental={rental}
              products={products}
              email={user.email}
              busy={busy}
              onAction={openAction}
              onInvoice={downloadInvoice}
              onMessages={onMessages}
              onViewDetails={viewDetails}
              onPickup={setPickupRental}
              onReturn={requestReturnCode}
            />
          ))
        )}
        {!loading && !visible.length && !error && (
          <div className="cr-empty">
            <span>
              <Symbol name="box" size={34} />
            </span>
            <h2>
              {rentals.length ? 'No rentals match this view' : 'Your next great plan starts here'}
            </h2>
            <p>
              {rentals.length
                ? 'Try another item, booking ID, or filter.'
                : 'Find the gear you need. Your bookings and handover updates will appear right here.'}
            </p>
            <button
              className="cr-button cr-primary"
              onClick={
                rentals.length
                  ? () => {
                      setSearch('')
                      setFilter('all')
                      setStatusFilter('all')
                    }
                  : onBrowse
              }
            >
              {rentals.length ? 'Show all rentals' : 'Explore rental items'}
              <Symbol name="arrow" size={17} />
            </button>
          </div>
        )}
      </div>
      <aside className="cr-email-guide">
        <span className="cr-guide-icon">
          <Symbol name="mail" size={24} />
        </span>
        <div>
          <h2>A little code. Extra peace of mind.</h2>
          <p>
            Verify your pickup email code here, then meet an administrator for the physical
            handover. An administrator sends a separate return code when your items come back. Codes
            expire after 5 minutes.
          </p>
        </div>
        <span className="cr-guide-tag">
          <Symbol name="shield" size={15} />
          Verified with you
        </span>
      </aside>
      {selectedRental && (
        <CustomerRentalDetails
          key={selectedRental._id}
          summary={rentals.find((rental) => rental._id === selectedRental._id) || selectedRental}
          api={api}
          onRentalUpdate={updateRental}
          onClose={() => setSelectedRental(null)}
          onAction={openAction}
          onInvoice={downloadInvoice}
          busy={busy}
          onPickup={setPickupRental}
          onReturn={requestReturnCode}
        />
      )}
      {pickupRental && (
        <CustomerPickupModal
          rental={rentals.find((entry) => entry._id === pickupRental._id) || pickupRental}
          api={api}
          onClose={() => setPickupRental(null)}
          onRequested={(message) => {
            setNotice(message)
            load()
          }}
        />
      )}
      {action && (
        <ActionDialog
          action={action}
          busy={Boolean(busy)}
          error={actionError}
          onConfirm={confirmAction}
          onClose={() => {
            if (!busy) setAction(null)
          }}
        />
      )}
    </section>
  )
}
