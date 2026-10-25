import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readJsonResponse } from '../../../services/http.js'
import { PrivateIdentityPhoto } from '../components/PrivateIdentityPhoto.jsx'
import { PasswordDialog } from '../components/PasswordDialog.jsx'
import { addressText } from '../utils/address.js'

const labels = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  resubmission_required: 'Resubmission required',
  not_submitted: 'Not submitted',
}
export default function CustomerVerifications({ token }) {
  const [status, setStatus] = useState('pending'),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0)
  const [data, setData] = useState({ verifications: [], total: 0, pages: 1 }),
    [disputes, setDisputes] = useState([]),
    [selected, setSelected] = useState(null),
    [claim, setClaim] = useState(null),
    [resolution, setResolution] = useState(''),
    [release, setRelease] = useState(false),
    [confirmClaim, setConfirmClaim] = useState(false)
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const api = useCallback(
    async (url, options = {}) =>
      readJsonResponse(
        await fetch(`/api/admin/customer-verifications${url}`, {
          ...options,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
        }),
      ),
    [token],
  )
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    const controller = new AbortController()
    queueMicrotask(() => {
      if (!controller.signal.aborted) setLoading(true)
    })
    Promise.all([
      api(`?${new URLSearchParams({ status, q: query, page: String(page) })}`, {
        signal: controller.signal,
      }),
      api('/disputes', { signal: controller.signal }),
    ])
      .then(([result, claims]) => {
        if (!controller.signal.aborted) {
          setData(result)
          setDisputes(claims.disputes)
          setError('')
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [api, status, query, page, revision])
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') setRevision((value) => value + 1)
    }
    const timer = setInterval(refresh, 20000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])
  const resolve = async (password) => {
    const result = await api(`/disputes/${claim._id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ reason: resolution, releaseExistingClaim: release, password }),
    })
    setConfirmClaim(false)
    setClaim(null)
    setResolution('')
    setRelease(false)
    setNotice(result.message)
    setRevision((value) => value + 1)
  }
  return (
    <section className="iv-admin">
      <header className="iv-heading">
        <span className="iv-kicker">TRUST & SAFETY</span>
        <h2>Customer Verifications</h2>
        <p>
          Review the evidence. Make a clear decision. Every sensitive document view and decision is
          audited.
        </p>
      </header>
      {notice && (
        <p className="iv-alert success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="iv-alert error" role="alert">
          {error}
        </p>
      )}
      <div className="iv-toolbar">
        <label>
          Search customer
          <input
            placeholder="Legal name or full customer ID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          Verification status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value)
              setPage(1)
            }}
          >
            <option value="all">All statuses</option>
            {Object.entries(labels).map(([key, value]) => (
              <option value={key} key={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <button className="iv-button secondary" onClick={() => setRevision((value) => value + 1)}>
          Refresh
        </button>
      </div>
      <div className="iv-card iv-table-wrap">
        <table className="iv-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Masked NIC</th>
              <th>Submitted</th>
              <th>Status</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="5">
                  <span className="iv-skeleton" role="status">
                    Loading verifications…
                  </span>
                </td>
              </tr>
            ) : (
              data.verifications.map((row) => (
                <tr key={row._id}>
                  <td>
                    <b>{row.fullName || 'Legacy profile'}</b>
                    <small>{row.userId}</small>
                  </td>
                  <td>{row.nicMasked || 'Needs secure submission'}</td>
                  <td>
                    {row.submittedAt
                      ? new Date(row.submittedAt).toLocaleString('en-LK')
                      : 'Not submitted'}
                  </td>
                  <td>
                    <span className={`iv-status-pill ${row.status}`}>{labels[row.status]}</span>
                  </td>
                  <td>
                    <button className="iv-button secondary" onClick={() => setSelected(row._id)}>
                      View Details
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && !data.verifications.length && (
          <p className="iv-empty">No verifications match this view.</p>
        )}
        <div className="iv-actions">
          <small>
            {data.total} submissions · page {page} of {data.pages}
          </small>
          <button
            className="iv-button secondary"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </button>
          <button
            className="iv-button secondary"
            disabled={page >= data.pages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </button>
        </div>
      </div>
      {disputes.length > 0 && (
        <section className="iv-card">
          <h3>Identity support claims</h3>
          <p>
            No claim automatically overrides identity ownership. Investigate evidence and
            outstanding rentals before recovery.
          </p>
          {disputes.map((row) => (
            <article className="iv-dispute-row" key={row._id}>
              <div>
                <b>Customer {row.userId}</b>
                <p>{row.message}</p>
                <small>{new Date(row.createdAt).toLocaleString('en-LK')}</small>
              </div>
              <button
                className="iv-button secondary"
                onClick={() => {
                  setClaim(row)
                  setResolution('')
                  setRelease(false)
                }}
              >
                Investigate claim
              </button>
            </article>
          ))}
        </section>
      )}
      {claim && (
        <section className="iv-card">
          <h3>Resolve support claim</h3>
          <label>
            Investigation and recovery instructions
            <textarea
              minLength={10}
              maxLength={500}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
            />
          </label>
          <label className="iv-consent">
            <input
              type="checkbox"
              checked={release}
              onChange={(event) => setRelease(event.target.checked)}
            />
            After independently validating evidence, release the existing NIC reservation for a new
            review. This revokes that approval; it does not approve the claimant.
          </label>
          <div className="iv-actions">
            <button className="iv-button secondary" onClick={() => setClaim(null)}>
              Cancel
            </button>
            <button
              className="iv-button"
              disabled={resolution.trim().length < 10}
              onClick={() => setConfirmClaim(true)}
            >
              Confirm investigation with password
            </button>
          </div>
        </section>
      )}
      {selected && (
        <VerificationDetails
          key={selected}
          id={selected}
          token={token}
          api={api}
          onClose={() => setSelected(null)}
          onDecision={(message) => {
            setNotice(message)
            setSelected(null)
            setRevision((value) => value + 1)
          }}
        />
      )}
      {confirmClaim && (
        <PasswordDialog
          title="Authorize identity claim resolution"
          onClose={() => setConfirmClaim(false)}
          onConfirm={resolve}
        />
      )}
    </section>
  )
}

function VerificationDetails({ id, token, api, onClose, onDecision }) {
  const dialog = useRef(null),
    [identity, setIdentity] = useState(null),
    [error, setError] = useState(''),
    [decision, setDecision] = useState('approved'),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false)
  useLayoutEffect(() => {
    const node = dialog.current,
      previous = document.activeElement
    node.showModal()
    return () => {
      node.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    api(`/${id}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setIdentity(result.verification)
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message)
      })
    return () => controller.abort()
  }, [api, id])
  const decide = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = await api(`/${id}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason, revision: identity.revision }),
      })
      onDecision(result.message)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="iv-dialog iv-review-dialog"
      aria-labelledby="iv-review-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <header className="iv-review-heading">
        <div>
          <span className="iv-kicker">RESTRICTED VERIFICATION EVIDENCE</span>
          <h2 id="iv-review-title">{identity?.fullName || 'Customer identity details'}</h2>
        </div>
        <button className="iv-button secondary" disabled={busy} onClick={onClose}>
          Close details
        </button>
      </header>
      {error && (
        <p role="alert" className="iv-alert error">
          {error}
        </p>
      )}
      {identity && (
        <>
          <dl className="iv-summary">
            <div>
              <dt>Customer ID</dt>
              <dd>{identity.userId}</dd>
            </div>
            <div>
              <dt>NIC · review access only</dt>
              <dd>{identity.nic || 'Secure resubmission required'}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{identity.dateOfBirth}</dd>
            </div>
            <div>
              <dt>Contact</dt>
              <dd>
                {identity.email} · {identity.phone}
              </dd>
            </div>
            <div>
              <dt>Submitted residential address</dt>
              <dd>{addressText(identity.address)}</dd>
            </div>
          </dl>
          <div className="iv-upload-grid">
            {identity.hasFront && (
              <PrivateIdentityPhoto
                url={`/api/admin/customer-verifications/${id}/documents/front`}
                token={token}
                label="NIC front"
              />
            )}
            {identity.hasBack && (
              <PrivateIdentityPhoto
                url={`/api/admin/customer-verifications/${id}/documents/back`}
                token={token}
                label="NIC back"
              />
            )}
          </div>
          <section>
            <h3>Decision history</h3>
            <ol className="iv-history">
              {identity.history?.map((event, index) => (
                <li key={index}>
                  <b>{labels[event.status] || event.status}</b>
                  <small>
                    {new Date(event.at).toLocaleString('en-LK')} · administrator/customer{' '}
                    {event.by || 'legacy'}
                  </small>
                  {event.reason && <p>{event.reason}</p>}
                </li>
              ))}
            </ol>
          </section>
          {identity.status === 'pending' ? (
            <form onSubmit={decide}>
              <label>
                Verification decision
                <select value={decision} onChange={(event) => setDecision(event.target.value)}>
                  <option value="approved">Approve identity</option>
                  <option value="rejected">Reject with feedback</option>
                  <option value="resubmission_required">Request resubmission</option>
                </select>
              </label>
              <label>
                {decision === 'approved' ? 'Review note (optional)' : 'Required specific feedback'}
                <textarea
                  required={decision !== 'approved'}
                  minLength={decision === 'approved' ? undefined : 5}
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </label>
              <label className="iv-consent">
                <input
                  type="checkbox"
                  required
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                I reviewed the submitted identity details, documents and address. This is not my own
                submission.
              </label>
              <button className="iv-button" disabled={busy || !checked}>
                {busy ? 'Recording decision…' : 'Record verification decision'}
              </button>
            </form>
          ) : (
            <p className="iv-alert">
              This submission is {labels[identity.status]}. Only pending submissions can receive a
              decision.
            </p>
          )}
        </>
      )}
    </dialog>
  )
}
