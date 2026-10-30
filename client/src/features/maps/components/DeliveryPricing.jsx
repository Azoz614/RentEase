import { useEffect, useState } from 'react'

export function DeliveryPricing({ api }) {
  const [settings, setSettings] = useState(null),
    [notice, setNotice] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const fields = {
    deliveryBaseFee: 'Delivery base fee (LKR / shop)',
    deliveryPerKm: 'Delivery rate (LKR / km)',
    returnCollectionBaseFee: 'Return base fee (LKR / shop)',
    returnCollectionPerKm: 'Return rate (LKR / km)',
  }
  useEffect(() => {
    api('/api/admin/settings')
      .then((result) => setSettings(result.settings))
      .catch((failure) => setError(failure.message))
  }, [api])
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await api('/api/admin/settings', {
        method: 'PATCH',
        body: JSON.stringify(
          Object.fromEntries(Object.keys(fields).map((key) => [key, Number(settings[key] || 0)])),
        ),
      })
      setSettings(result.settings)
      setNotice(result.message)
    } catch (failure) {
      if (!failure.cancelled) setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="re-map-panel" onSubmit={save}>
      <h2>Delivery pricing</h2>
      <p>
        Delivery is fixed at Rs. 50 per driving kilometer, with no base fee. Return charges, when
        enabled, use the reverse driving route and are included at checkout.
      </p>
      {settings && (
        <>
          <div className="re-map-grid">
            {Object.entries(fields).map(([key, name]) => (
              <label key={key}>
                {name}
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  required
                  readOnly={key === 'deliveryBaseFee' || key === 'deliveryPerKm'}
                  value={settings[key] ?? (key.startsWith('return') ? 0 : '')}
                  onChange={(event) => setSettings({ ...settings, [key]: event.target.value })}
                />
              </label>
            ))}
          </div>
          <button disabled={busy} className="re-map-primary">
            {busy ? 'Saving…' : 'Save delivery rates'}
          </button>
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="re-map-error">
          {error}
        </p>
      )}
    </form>
  )
}
