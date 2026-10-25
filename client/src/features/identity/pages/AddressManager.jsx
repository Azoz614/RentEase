import { useCallback, useEffect, useState } from 'react'
import { AddressFields } from '../components/AddressFields.jsx'
import { PasswordDialog } from '../components/PasswordDialog.jsx'
import { LocationPicker } from '../../maps/components/LocationPicker.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { blankAddress, addressText } from '../utils/address.js'

export default function AddressManager({ api, onBack, onUpdate }) {
  const [pinOpen, setPinOpen] = useState(false)
  const [data, setData] = useState({ addresses: [], previousRentalAddresses: [] }),
    [editing, setEditing] = useState(null),
    [form, setForm] = useState({ ...blankAddress }),
    [makeDefault, setMakeDefault] = useState(true),
    [confirmation, setConfirmation] = useState(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    try {
      setData(await api('/api/addresses'))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setLoading(false)
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
  const open = (address = null) => {
    setEditing(address || { _id: null })
    setForm(address || { ...blankAddress })
    setMakeDefault(address?.isDefault ?? true)
    setNotice('')
    setPinOpen(false)
  }
  const confirm = async (password) => {
    const url =
      confirmation.type === 'default'
        ? `/api/addresses/${confirmation.address._id}/default`
        : editing?._id
          ? `/api/addresses/${editing._id}`
          : '/api/addresses'
    const result = await api(url, {
      method: confirmation.type === 'default' || !editing?._id ? 'POST' : 'PUT',
      body: JSON.stringify({ password, address: form, isDefault: makeDefault }),
    })
    setConfirmation(null)
    setEditing(null)
    setNotice(result.message)
    await load()
    await onUpdate?.()
  }
  return (
    <section className="iv-workspace">
      <button className="iv-back" onClick={onBack}>
        ← Back to rentals
      </button>
      <header className="iv-heading">
        <span className="iv-kicker">YOUR PLACES, SECURELY SAVED</span>
        <h1>Your address book.</h1>
        <p>
          Your default residential address is available at checkout; a temporary delivery location
          can be selected for an individual booking. Changes require your password and never rewrite
          an existing rental.
        </p>
      </header>
      {error && (
        <p className="iv-alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="iv-alert success" role="status">
          {notice}
        </p>
      )}
      {loading ? (
        <div className="iv-skeleton" role="status">
          Loading addresses…
        </div>
      ) : (
        <>
          <div className="iv-address-grid">
            {data.addresses.map((address) => (
              <article
                className={`iv-card${address.isDefault ? ' is-default' : ''}`}
                key={address._id}
              >
                {address.isDefault && <span className="iv-badge">DEFAULT ADDRESS</span>}
                <h2>{address.city}</h2>
                <p>{addressText(address)}</p>
                <div className="iv-actions">
                  <button className="iv-button secondary" onClick={() => open(address)}>
                    Edit address
                  </button>
                  {!address.isDefault && (
                    <button
                      className="iv-button"
                      onClick={() => setConfirmation({ type: 'default', address })}
                    >
                      Make default
                    </button>
                  )}
                </div>
              </article>
            ))}
            <button className="iv-add-address" onClick={() => open()}>
              <span>
                <UiIcon name="plus" size={25} />
              </span>
              <b>Add a residential address</b>
              <small>Password confirmation required</small>
            </button>
          </div>
          {editing && (
            <form
              className="iv-card"
              onSubmit={(event) => {
                event.preventDefault()
                setConfirmation({ type: 'save' })
              }}
            >
              <h2>{editing._id ? 'Edit address' : 'New address'}</h2>
              <AddressFields value={form} onChange={setForm} />
              <details onToggle={(event) => setPinOpen(event.currentTarget.open)}>
                <summary>Choose address pin on the map</summary>
                {pinOpen && (
                  <LocationPicker
                    value={{ location: form.location, address: addressText(form) }}
                    onConfirm={(chosen) => {
                      setForm((current) => ({ ...current, location: chosen.location }))
                      setNotice(
                        'Map pin confirmed. Review the structured address fields and save with your password.',
                      )
                    }}
                  />
                )}
              </details>
              {form.location && (
                <p>
                  Confirmed map pin: {form.location.coordinates[1].toFixed(5)},{' '}
                  {form.location.coordinates[0].toFixed(5)}
                </p>
              )}
              <label className="iv-consent">
                <input
                  type="checkbox"
                  checked={makeDefault}
                  onChange={(event) => setMakeDefault(event.target.checked)}
                />
                Use as my default address
              </label>
              <div className="iv-actions">
                <button
                  className="iv-button secondary"
                  type="button"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button className="iv-button">Save with password confirmation</button>
              </div>
            </form>
          )}
          {data.previousRentalAddresses.length > 0 && (
            <section className="iv-card">
              <h2>Previously used rental addresses</h2>
              <p className="iv-muted">
                These are read-only snapshots, not current delivery instructions.
              </p>
              {data.previousRentalAddresses.map((entry, index) => (
                <p key={index}>
                  {addressText(entry.address)}{' '}
                  <small>· {new Date(entry.usedAt).toLocaleDateString('en-LK')}</small>
                </p>
              ))}
            </section>
          )}
        </>
      )}
      {confirmation && (
        <PasswordDialog
          title={
            confirmation.type === 'default'
              ? 'Change your default address'
              : 'Save your residential address'
          }
          onConfirm={confirm}
          onClose={() => setConfirmation(null)}
        />
      )}
    </section>
  )
}
