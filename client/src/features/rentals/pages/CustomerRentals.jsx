import ReturnMethodDialog from '../components/ReturnMethodDialog.jsx'
import { useDeliveryRefresh } from '../../delivery-partner/hooks/useDeliveryEvents.js'
import { shortId, filters, isUpcoming, isPast } from '../utils/customerRentalPresentation.js'

import { Symbol } from '../components/Symbol.jsx'
import { RentalCard } from '../components/RentalCard.jsx'
import { ActionDialog } from '../components/ActionDialog.jsx'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import '../styles/customer-rentals.css'
import '../styles/my-rentals-modern.css'
import CustomerRentalDetails from '../components/CustomerRentalDetails.jsx'
import { customerRentalStatus, preferLatestRental } from '../utils/customerRental.js'

const rentalGroup = (rental) => ['active', 'return_in_transit'].includes(rental.status) ? 'In progress'
  : ['pending', 'confirmed'].includes(rental.status) ? 'Upcoming rentals'
  : ['returned', 'completed'].includes(rental.status) ? 'Completed rentals'
  : rental.status === 'cancelled' ? 'Cancelled rentals' : 'Needs attention'
const groupOrder = ['In progress', 'Upcoming rentals', 'Needs attention', 'Completed rentals', 'Cancelled rentals']

export default function CustomerRentals({
  initialRentals = [],
  products = [],
  user,
  token,
  api,
  onRentalsChange,
  onBrowse,
  onMessages,
  onChat,
  focusRentalId,
  onFocusConsumed,
}) {
  const [rentals, setRentals] = useState(initialRentals)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedRental, setSelectedRental] = useState(null)
  const [returnRental, setReturnRental] = useState(null)
  const detailsTrigger = useRef(null)
  const refreshButton = useRef(null)
  const section = useRef(null)
  // The toolbar sticks just below the site navigation, whose height changes when it wraps.
  useLayoutEffect(() => {
    const nav = document.querySelector('.market-nav')
    if (!nav || !section.current) return
    const update = () => section.current?.style.setProperty('--cr-sticky-top', `${nav.offsetHeight}px`)
    update()
    if (!window.ResizeObserver) return
    const observer = new window.ResizeObserver(update)
    observer.observe(nav)
    return () => observer.disconnect()
  }, [])
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
  useEffect(() => {
    if (!focusRentalId) return
    const rental = rentals.find((entry) => entry._id === focusRentalId)
    if (rental) queueMicrotask(() => { setSelectedRental(rental); onFocusConsumed?.() })
  }, [focusRentalId, rentals, onFocusConsumed])
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
    completed: rentals.filter((rental) => ['returned', 'completed'].includes(rental.status)).length,
    cancelled: rentals.filter((rental) => rental.status === 'cancelled').length,
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
  const requestReturnCode = (rental) => setReturnRental(rental)
  const assignPartner = async (rental) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(`assign-${rental._id}`)
    setError('')
    try {
      const path = `/api/delivery/rentals/${rental._id}/assign`
      const result = await api(path, {
        method: 'POST',
        body: '{}',
      })
      if (!mounted.current) return
      setNotice(
        result.message ||
          'Finding nearby delivery partners.',
      )
      await load()
    } catch (failure) {
      if (mounted.current)
        setError(
          failure.message || 'We could not start the rider search. Please try again.',
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
          (filter === 'active' && ['active', 'return_in_transit'].includes(rental.status)) ||
          (filter === 'past' && isPast(rental)) ||
          (filter === 'completed' && ['returned', 'completed'].includes(rental.status)) ||
          (filter === 'cancelled' && rental.status === 'cancelled')
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
      }).sort((a, b) => groupOrder.indexOf(rentalGroup(a)) - groupOrder.indexOf(rentalGroup(b)) || new Date(b.createdAt) - new Date(a.createdAt)),
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
    <section ref={section} className="customer-rentals cr-modern" aria-labelledby="customer-rentals-heading">
      <h1 id="customer-rentals-heading" className="cr-screen-reader">My rentals</h1>
      {/* One full-width row pinned under the site navigation; tab counts double as the summary. */}
      <div className="cr-list-toolbar cr-sticky-toolbar">
        <nav className="cr-filters" aria-label="Filter your rentals">
          {filters.map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
              <span>{counts[key]}</span>
            </button>
          ))}
        </nav>
        <label className="cr-search">
          <Symbol name="search" size={16} />
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
        <button
          ref={refreshButton}
          className="cr-button cr-secondary cr-refresh"
          onClick={() => {
            setRefreshing(true)
            load()
          }}
          disabled={refreshing || loading}
        >
          <Symbol name="refresh" size={16} />
          {refreshing ? 'Refreshing…' : 'Refresh bookings'}
        </button>
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
          visible.map((rental, index) => (
            <Fragment key={rental._id}>
            {filter === 'all' && (index === 0 || rentalGroup(visible[index - 1]) !== rentalGroup(rental)) &&
              <h2 className="cr-group-label">{rentalGroup(rental)}<span>{visible.filter((entry) => rentalGroup(entry) === rentalGroup(rental)).length}</span></h2>}
            <RentalCard
              key={rental._id}
              rental={rental}
              products={products}
              email={user.email}
              busy={busy}
              onAction={openAction}
              onInvoice={downloadInvoice}
              onMessages={onMessages}
              onChat={onChat}
              onViewDetails={viewDetails}
              onReturn={requestReturnCode}
              onAssign={assignPartner}
            />
            </Fragment>
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
          onReturn={requestReturnCode}
        />
      )}
      {returnRental && (
        <ReturnMethodDialog rental={rentals.find((r) => r._id === returnRental._id) || returnRental}
          api={api} onClose={() => setReturnRental(null)} onUpdated={async (message) => { setNotice(message); await load() }} />
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
