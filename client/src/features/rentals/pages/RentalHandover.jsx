import { useDeliveryRefresh } from '../../delivery-partner/hooks/useDeliveryEvents.js'
import { formatCurrency as money } from '../../../utils/currency.js'
import { labels, shortId } from '../utils/handoverPresentation.js'

import { Glyph } from '../components/Glyph.jsx'
import { Status } from '../components/Status.jsx'
import { RentalAction } from '../components/RentalAction.jsx'
import { RentalDetails } from '../components/RentalDetails.jsx'
import { LifecycleConfirmation } from '../components/LifecycleConfirmation.jsx'
import { VerificationModal } from '../components/VerificationModal.jsx'
import { useCallback, useEffect, useState } from 'react'
import '../styles/rental-handover.css'
import { preferLatestRental } from '../utils/customerRental.js'

export default function RentalHandover({ token, refreshKey = 0 }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rentals: [], stats: {}, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [selected, setSelected] = useState(null)
  const [verification, setVerification] = useState(null)
  const [revision, setRevision] = useState(0)
  const refreshDelivery = useCallback(() => setRevision((v) => v + 1), [])
  useDeliveryRefresh(refreshDelivery)
  const request = useCallback(
    async (path, options = {}) => {
      const response = await fetch(path.startsWith('/api/') ? path : `/api/admin${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        },
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok)
        throw Object.assign(
          new Error(body.message || 'Could not connect to the rental service. Please try again.'),
          { ...body, status: response.status },
        )
      return body
    },
    [token],
  )

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    request(`/rentals?${new URLSearchParams({ q: query, status, page: String(page) })}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return
        setData(result)
        setSelected((current) =>
          current
            ? preferLatestRental(
                current,
                result.rentals.find((item) => item._id === current._id) || current,
              )
            : null,
        )
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [request, query, status, page, revision, refreshKey])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') setRevision((value) => value + 1)
    }
    const timer = setInterval(refresh, 20_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 6500)
    return () => clearTimeout(timer)
  }, [toast])

  const verified = async (message) => {
    setToast(message)
    setRevision((value) => value + 1)
    if (selected) {
      try {
        const result = await request(`/rentals/${selected._id}`)
        setSelected(result.rental)
      } catch {
        setSelected(null)
      }
    }
  }
  const stats = [
    ['Total bookings', data.stats.total, 'box', 'All rental orders'],
    ['Awaiting pickup', data.stats.awaitingPickup, 'clock', 'Confirmed and ready to prepare'],
    ['Currently on rental', data.stats.onRental, 'arrow', 'Items with your customers'],
    ['Returned rentals', data.stats.returned, 'check', 'Received and completed'],
  ]
  return (
    <section className="handover-workspace" aria-label="Rental pickup and return management">
      <div className="handover-intro">
        <div>
          <span className="handover-eyebrow">RENTAL OPERATIONS</span>
          <h2>Every handover. Verified.</h2>
          <p>A secure pickup, a smooth return, and a clear record of every step.</p>
        </div>
        <span className="handover-security">
          <Glyph name="shield" />
          Email-verified handovers
        </span>
      </div>
      <div className="handover-stats">
        {stats.map(([label, value, icon, detail], index) => (
          <article key={label} style={{ '--card-delay': `${index * 45}ms` }}>
            <div>
              <span>{label}</span>
              <Glyph name={icon} />
            </div>
            <strong>{value ?? '—'}</strong>
            <small>{detail}</small>
          </article>
        ))}
      </div>
      <section className="handover-list">
        <div className="handover-list-heading">
          <div>
            <h3>
              Rental orders <span>{data.total}</span>
            </h3>
            <p>Choose an order to verify pickup or return.</p>
          </div>
          <button
            className="handover-button secondary"
            onClick={() => setRevision((value) => value + 1)}
            disabled={loading}
          >
            <Glyph name="clock" />
            Refresh
          </button>
        </div>
        <div className="handover-toolbar">
          <label className="handover-search">
            <Glyph name="search" />
            <input
              aria-label="Search rental orders"
              placeholder="Search customer, item, or full rental ID…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="handover-filter">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All statuses</option>
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && (
          <div className="handover-feedback error" role="alert">
            {error}
            <button onClick={() => setRevision((value) => value + 1)}>Try again</button>
          </div>
        )}
        <div className="handover-table-wrap" aria-busy={loading}>
          <table className="handover-table">
            <thead>
              <tr>
                <th>Rental / customer</th>
                <th>Rental items</th>
                <th>Rental period</th>
                <th>Status</th>
                <th>
                  <span className="handover-sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 4 }, (_, index) => (
                    <tr key={index} className="handover-skeleton" aria-hidden="true">
                      <td>
                        <i />
                        <i />
                      </td>
                      <td>
                        <i />
                      </td>
                      <td>
                        <i />
                      </td>
                      <td>
                        <i />
                      </td>
                      <td>
                        <i />
                      </td>
                    </tr>
                  ))
                : data.rentals.map((rental) => (
                    <tr key={rental._id}>
                      <td data-label="Customer">
                        <button className="handover-order-link" onClick={() => setSelected(rental)}>
                          {shortId(rental._id)}
                        </button>
                        <b>{rental.customerId?.username || 'Customer unavailable'}</b>
                        <small>{rental.customerId?.maskedEmail || 'No email available'}</small>
                      </td>
                      <td data-label="Items">
                        <b>{rental.items[0]?.title || 'Rental items'}</b>
                        <small>
                          {rental.items.length > 1 ? `+ ${rental.items.length - 1} more · ` : ''}
                          {money(rental.total)}
                        </small>
                      </td>
                      <td data-label="Rental period">
                        <b>
                          {new Date(rental.startDate).toLocaleDateString('en-LK', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </b>
                        <small>
                          to{' '}
                          {new Date(rental.endDate).toLocaleDateString('en-LK', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </small>
                      </td>
                      <td data-label="Status">
                        <Status value={rental.status} workflow={rental.pickupVerification} />
                      </td>
                      <td className="handover-row-actions">
                        <RentalAction rental={rental} onVerify={setVerification} />
                        <button
                          className="handover-detail-button"
                          onClick={() => setSelected(rental)}
                          aria-label={`View rental ${shortId(rental._id)}`}
                        >
                          Details <Glyph name="arrow" width="15" />
                        </button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!loading && !data.rentals.length && !error && (
          <div className="handover-empty">
            <span>
              <Glyph name="box" width="28" height="28" />
            </span>
            <h3>
              {query || status ? 'No matching rentals' : 'Your rental orders will appear here'}
            </h3>
            <p>
              {query || status
                ? 'Try a different customer, item, or status.'
                : 'Accept a booking request to prepare its pickup verification.'}
            </p>
            {(query || status) && (
              <button
                className="handover-button secondary"
                onClick={() => {
                  setSearch('')
                  setStatus('')
                  setPage(1)
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        <div className="handover-pagination">
          <small>
            Page {page} of {data.pages} · {data.total} orders
          </small>
          <div>
            <button
              aria-label="Previous rental page"
              disabled={page <= 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <button
              aria-label="Next rental page"
              disabled={page >= data.pages || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      {selected && (
        <RentalDetails
          rental={selected}
          request={request}
          onClose={() => setSelected(null)}
          onVerify={setVerification}
        />
      )}
      {verification && ['ready', 'complete'].includes(verification.type) && (
        <LifecycleConfirmation
          rental={verification.rental}
          type={verification.type}
          request={request}
          onClose={() => setVerification(null)}
          onConfirmed={async (message) => {
            await verified(message)
            setVerification(null)
          }}
        />
      )}
      {verification &&
        !['ready', 'complete'].includes(verification.type) && (
          <VerificationModal
            rental={verification.rental}
            type={verification.type}
            request={request}
            onClose={() => setVerification(null)}
            onVerified={verified}
          />
        )}
      {toast && (
        <div className="handover-toast" role="status">
          <span>
            <Glyph name="check" />
          </span>
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <Glyph name="close" />
          </button>
        </div>
      )}
    </section>
  )
}
