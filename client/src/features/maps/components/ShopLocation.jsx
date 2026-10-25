import { useEffect, useState } from 'react'
import { LocationPicker } from './LocationPicker.jsx'

export function ShopLocation({ api }) {
  const [value, setValue] = useState(null),
    [editing, setEditing] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  useEffect(() => {
    let active = true
    api('/api/locations/shop')
      .then((result) => {
        if (active) setValue(result)
      })
      .catch((failure) => {
        if (active) setError(failure.message)
      })
    return () => {
      active = false
    }
  }, [api])
  const save = async (location) => {
    try {
      const result = await api('/api/locations/shop', {
        method: 'PUT',
        body: JSON.stringify(location),
      })
      setValue(location)
      setEditing(false)
      setError('')
      setNotice(result.message)
    } catch (failure) {
      setError(failure.message)
    }
  }
  return (
    <section className="re-map-panel">
      <h2>Shop pickup location</h2>
      <p>
        {value?.address ||
          'Confirm your actual shop location to enable nearby discovery and delivery quotes.'}
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="re-map-error">
          {error}
        </p>
      )}
      <button type="button" onClick={() => setEditing(!editing)}>
        {editing ? 'Cancel editing' : value?.location ? 'Edit shop location' : 'Set shop location'}
      </button>
      {editing && <LocationPicker value={value} onConfirm={save} />}
    </section>
  )
}
