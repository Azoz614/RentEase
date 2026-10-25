import { useCallback, useEffect, useState } from 'react'
import { AddressFields } from '../components/AddressFields.jsx'
import { PasswordDialog } from '../components/PasswordDialog.jsx'
import { IdentityStatusCard } from '../components/IdentityStatusCard.jsx'
import { PrivateIdentityPhoto } from '../components/PrivateIdentityPhoto.jsx'
import { blankAddress, addressText } from '../utils/address.js'
import { uploadIdentity } from '../api/uploadIdentity.js'

const steps = ['Your identity', 'NIC photos', 'Residential address', 'Review & submit']
export default function CustomerVerification({
  api,
  token,
  onBack,
  onUpdate,
  upload = uploadIdentity,
}) {
  const [maxBirthDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [identity, setIdentity] = useState(null),
    [step, setStep] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    fullName: '',
    nic: '',
    dateOfBirth: '',
    phone: '',
    address: { ...blankAddress },
    consent: false,
  })
  const [showDocuments, setShowDocuments] = useState(false)
  const [front, setFront] = useState(''),
    [back, setBack] = useState(''),
    [progress, setProgress] = useState(0),
    [confirm, setConfirm] = useState(false),
    [dispute, setDispute] = useState(''),
    [duplicate, setDuplicate] = useState(false)
  const load = useCallback(async () => {
    try {
      const result = await api('/api/identity/profile')
      setIdentity(result)
      setForm((current) => ({
        ...current,
        fullName: result.fullName || '',
        nic: result.nic || '',
        dateOfBirth: result.dateOfBirth || '',
        phone: result.phone || '',
        address: result.defaultAddress || { ...blankAddress },
      }))
      onUpdate?.(result)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setLoading(false)
    }
  }, [api, onUpdate])
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) load()
    })
    return () => {
      active = false
    }
  }, [load])
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const checkNic = async () => {
    setBusy(true)
    setError('')
    setDuplicate(false)
    try {
      await api('/api/identity/check-nic', {
        method: 'POST',
        body: JSON.stringify({ nic: form.nic }),
      })
      return true
    } catch (failure) {
      setError(failure.message)
      setDuplicate(failure.code === 'DUPLICATE_NIC')
      return false
    } finally {
      setBusy(false)
    }
  }
  const readPhoto = async (file, side) => {
    setError('')
    if (
      !file ||
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 3 * 1024 * 1024
    ) {
      setError('Choose a clear JPG, PNG or WebP photo no larger than 3 MB.')
      return
    }
    const reader = new FileReader()
    reader.onerror = () => setError('Could not read this photo. Try another image.')
    reader.onload = () => (side === 'front' ? setFront : setBack)(reader.result)
    reader.readAsDataURL(file)
  }
  const next = async (event) => {
    event.preventDefault()
    setError('')
    if (step === 0 && !(await checkNic())) return
    if (step === 1 && (!front || !back)) {
      setError(
        'Upload both sides of your NIC. The server will validate and safely re-encode each photo.',
      )
      return
    }
    if (step < 3) setStep((value) => value + 1)
    else setConfirm(true)
  }
  const submit = async (password) => {
    setBusy(true)
    setProgress(0)
    try {
      const result = await upload({ ...form, front, back, password }, token, setProgress)
      setConfirm(false)
      setFront('')
      setBack('')
      setForm((current) => ({ ...current, nic: '', consent: false }))
      setNotice(result.message)
      await load()
    } finally {
      setBusy(false)
    }
  }
  const submitDispute = async () => {
    setBusy(true)
    try {
      const result = await api('/api/identity/disputes', {
        method: 'POST',
        body: JSON.stringify({ nic: form.nic, message: dispute }),
      })
      setNotice(result.message)
      setDispute('')
      setDuplicate(false)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  const locked = ['pending', 'approved'].includes(identity?.status)
  useEffect(() => {
    if (!locked) return
    const refresh = () => {
      if (document.visibilityState !== 'hidden') load()
    }
    const timer = setInterval(refresh, 20000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [locked, load])
  return (
    <section className="iv-workspace" aria-labelledby="iv-title">
      <button className="iv-back" onClick={onBack}>
        ← Back to rentals
      </button>
      <header className="iv-heading">
        <span className="iv-kicker">A TRUSTED COMMUNITY STARTS WITH YOU</span>
        <h1 id="iv-title">Your identity. Protected.</h1>
        <p>
          Complete one careful review, then rent with confidence. Format checks are not proof of
          identity—an administrator reviews every submission.
        </p>
      </header>
      {loading ? (
        <div className="iv-skeleton" role="status">
          Loading your verification…
        </div>
      ) : (
        <>
          <IdentityStatusCard
            identity={identity}
            hideAction={locked}
            onOpen={() => {
              if (!locked) setStep(0)
            }}
          />
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
          {locked ? (
            <div className="iv-card">
              <h2>
                {identity.status === 'pending'
                  ? 'Your submission is safely with the team'
                  : 'Your identity is approved'}
              </h2>
              <p>
                {identity.status === 'pending'
                  ? 'You can browse items now. Rental requests become available after administrator approval. You cannot replace a submission while it is under review.'
                  : 'You can request available items. Address updates require your password and do not revoke NIC approval.'}
              </p>
              <dl className="iv-summary">
                <div>
                  <dt>Legal name</dt>
                  <dd>{identity.fullName}</dd>
                </div>
                <div>
                  <dt>NIC</dt>
                  <dd>{identity.maskedNic}</dd>
                </div>
                <div>
                  <dt>Submitted</dt>
                  <dd>
                    {identity.submittedAt
                      ? new Date(identity.submittedAt).toLocaleString('en-LK')
                      : 'Not recorded'}
                  </dd>
                </div>
                <div>
                  <dt>Current address</dt>
                  <dd>{addressText(identity.defaultAddress)}</dd>
                </div>
              </dl>
              <div className="iv-actions">
                <button className="iv-button" onClick={onBack}>
                  Continue browsing
                </button>
                <button
                  className="iv-button secondary"
                  onClick={() => setShowDocuments((value) => !value)}
                >
                  {showDocuments ? 'Hide submitted documents' : 'View my submitted documents'}
                </button>
              </div>
              {showDocuments && (
                <div className="iv-upload-grid">
                  <PrivateIdentityPhoto
                    url="/api/identity/documents/front"
                    token={token}
                    label="Your submitted NIC front"
                  />
                  <PrivateIdentityPhoto
                    url="/api/identity/documents/back"
                    token={token}
                    label="Your submitted NIC back"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="iv-form-layout">
              <form className="iv-card iv-form" onSubmit={next}>
                <ol className="iv-stepper" aria-label="Verification steps">
                  {steps.map((label, index) => (
                    <li
                      key={label}
                      aria-current={step === index ? 'step' : undefined}
                      className={index <= step ? 'active' : ''}
                    >
                      <span>{index < step ? '✓' : index + 1}</span>
                      <b>{label}</b>
                    </li>
                  ))}
                </ol>
                <span className="iv-kicker">STEP {step + 1} OF 4</span>
                <h2>{steps[step]}</h2>
                {step === 0 && (
                  <div className="iv-field-grid">
                    <label className="iv-span-two">
                      Full legal name
                      <input
                        required
                        minLength={3}
                        maxLength={120}
                        autoComplete="name"
                        value={form.fullName}
                        onChange={(event) => change('fullName', event.target.value)}
                      />
                    </label>
                    <label>
                      NIC number
                      <input
                        required
                        pattern="([0-9]{9}[VvXx]|[0-9]{12})"
                        value={form.nic}
                        maxLength={12}
                        onChange={(event) => {
                          change('nic', event.target.value.replace(/\s/g, '').toUpperCase())
                          setDuplicate(false)
                        }}
                        placeholder="9 digits + V/X, or 12 digits"
                      />
                    </label>
                    <label>
                      Date of birth
                      <input
                        required
                        type="date"
                        max={maxBirthDate}
                        value={form.dateOfBirth}
                        onChange={(event) => change('dateOfBirth', event.target.value)}
                      />
                    </label>
                    <label>
                      Contact phone
                      <input
                        required
                        type="tel"
                        minLength={7}
                        maxLength={24}
                        autoComplete="tel"
                        value={form.phone}
                        onChange={(event) => change('phone', event.target.value)}
                      />
                    </label>
                    <label>
                      Registered email
                      <input value={identity?.email || ''} readOnly />
                    </label>
                  </div>
                )}
                {step === 1 && (
                  <>
                    <p>
                      Use clear, well-lit photos with all four corners visible. No glare, blur or
                      unrelated documents. Both supported NIC formats contain important information
                      on the reverse.
                    </p>
                    <div className="iv-upload-grid">
                      {[
                        ['front', front],
                        ['back', back],
                      ].map(([side, preview]) => (
                        <section
                          className="iv-upload"
                          key={side}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault()
                            readPhoto(event.dataTransfer.files[0], side)
                          }}
                        >
                          <h3>NIC {side}</h3>
                          {preview ? (
                            <img src={preview} alt={`Your NIC ${side} preview`} />
                          ) : (
                            <div className="iv-upload-placeholder" aria-hidden="true">
                              ＋
                            </div>
                          )}
                          <label className="iv-file-button">
                            {preview ? 'Replace photo' : 'Choose photo'}
                            <input
                              type="file"
                              aria-label={`Choose NIC ${side} photo`}
                              accept="image/jpeg,image/png,image/webp"
                              onChange={(event) => readPhoto(event.target.files[0], side)}
                            />
                          </label>
                          <label className="iv-file-button secondary">
                            Take photo
                            <input
                              type="file"
                              aria-label={`Capture NIC ${side} photo`}
                              capture="environment"
                              accept="image/jpeg,image/png,image/webp"
                              onChange={(event) => readPhoto(event.target.files[0], side)}
                            />
                          </label>
                          <small>JPG, PNG, WebP · maximum 3 MB</small>
                        </section>
                      ))}
                    </div>
                  </>
                )}
                {step === 2 && (
                  <>
                    <p>
                      Your complete residential address becomes the default for new rentals.
                      Existing rental addresses are never overwritten.
                    </p>
                    <AddressFields
                      value={form.address}
                      onChange={(value) => change('address', value)}
                    />
                  </>
                )}
                {step === 3 && (
                  <>
                    <dl className="iv-summary">
                      <div>
                        <dt>Legal name</dt>
                        <dd>{form.fullName}</dd>
                      </div>
                      <div>
                        <dt>NIC</dt>
                        <dd>
                          {form.nic.slice(0, 2)}•••••{form.nic.slice(-3)}
                        </dd>
                      </div>
                      <div>
                        <dt>Date of birth</dt>
                        <dd>{form.dateOfBirth}</dd>
                      </div>
                      <div>
                        <dt>Phone</dt>
                        <dd>{form.phone}</dd>
                      </div>
                      <div>
                        <dt>Address</dt>
                        <dd>{addressText(form.address)}</dd>
                      </div>
                    </dl>
                    <label className="iv-consent">
                      <input
                        type="checkbox"
                        required
                        checked={form.consent}
                        onChange={(event) => change('consent', event.target.checked)}
                      />
                      I confirm this information is accurate and consent to restricted administrator
                      review of my NIC and residential details for rental eligibility.
                    </label>
                    <p className="iv-muted">
                      Confirm your password in the next step to authorize saving this residential
                      address.
                    </p>
                  </>
                )}
                <div className="iv-actions">
                  {step > 0 && (
                    <button
                      type="button"
                      className="iv-button secondary"
                      disabled={busy}
                      onClick={() => setStep((value) => value - 1)}
                    >
                      Back
                    </button>
                  )}
                  <button className="iv-button" disabled={busy}>
                    {busy ? 'Checking…' : step === 3 ? 'Submit for review' : 'Continue →'}
                  </button>
                </div>
              </form>
              <aside className="iv-card iv-privacy">
                <span className="iv-privacy-icon">◇</span>
                <h2>Private by design.</h2>
                <p>
                  Your NIC and photos are encrypted in private storage. Only you and authorized
                  verification administrators can view them.
                </p>
                <p>
                  Documents are retained for the configured review period (normally 365 days after a
                  decision), then an operator can securely remove them. Audit decisions and
                  duplicate-prevention claims remain restricted.
                </p>
                <p>
                  For corrections, deletion requests or an NIC discrepancy, contact support. An
                  approved identity can only be changed through a new administrator-controlled
                  review.
                </p>
              </aside>
            </div>
          )}
          {duplicate && (
            <section className="iv-card">
              <h2>Need help with this NIC?</h2>
              <p>
                No other account details are disclosed. Explain the conflict without including
                passwords or document images.
              </p>
              <label>
                Support claim
                <textarea
                  minLength={20}
                  maxLength={1000}
                  value={dispute}
                  onChange={(event) => setDispute(event.target.value)}
                />
              </label>
              <button
                className="iv-button secondary"
                disabled={busy || dispute.trim().length < 20}
                onClick={submitDispute}
              >
                Send private support claim
              </button>
            </section>
          )}
          {identity?.history?.length > 0 && (
            <section className="iv-card">
              <h2>Verification history</h2>
              <ol className="iv-history">
                {identity.history.map((event, index) => (
                  <li key={index}>
                    <b>{event.status.replaceAll('_', ' ')}</b>
                    <small>{new Date(event.at).toLocaleString('en-LK')}</small>
                    {event.reason && <p>{event.reason}</p>}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </>
      )}
      {confirm && (
        <PasswordDialog
          progress={busy ? progress : null}
          title="Submit verification securely"
          onClose={() => {
            if (!busy) setConfirm(false)
          }}
          onConfirm={submit}
        />
      )}
      {busy && confirm && (
        <div className="iv-upload-progress" role="status">
          <progress value={progress} max="100" aria-label="Identity upload progress" />
          <span>
            {progress < 100
              ? `Uploading securely… ${progress}%`
              : 'Upload received. Validating and encrypting your documents…'}
          </span>
        </div>
      )}
    </section>
  )
}
