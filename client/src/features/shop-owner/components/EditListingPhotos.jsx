import { useState } from 'react'
import ProductPhotoManager from '../../products/components/ProductPhotoManager.jsx'
import { Modal } from '../../rentals/components/Modal.jsx'

export default function EditListingPhotos({ product, api, onClose, onSaved }) {
  const [photos, setPhotos] = useState(() => (product.photos || []).map((data, index) => ({ data, name: `Saved photo ${index + 1}` })))
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api(`/api/owner/products/${product._id}`, { method: 'PATCH', body: JSON.stringify({ photos: photos.map((photo) => photo.data) }) })
    } catch (failure) {
      setError(failure.message || 'Could not save the photos. Please try again.')
      setBusy(false)
      return
    }
    onSaved()
  }
  return (
    <Modal titleId="edit-listing-photos-title" onClose={() => { if (!busy && !reading) onClose() }}>
      <form onSubmit={save}>
        <h2 id="edit-listing-photos-title">Photos for {product.title}</h2>
        <ProductPhotoManager photos={photos} setPhotos={setPhotos} disabled={busy} onReadingChange={setReading} />
        {error && <p role="alert">{error}</p>}
        <div className="product-photo-dialog-actions">
          <button type="button" disabled={busy || reading} onClick={onClose}>Cancel</button>
          <button className="owner-primary" disabled={busy || reading || !photos.length}>{busy ? 'Saving…' : 'Save photos'}</button>
        </div>
      </form>
    </Modal>
  )
}
