import { useId, useState } from 'react'
import '../styles/product-photo-manager.css'

export const MAX_PRODUCT_PHOTOS = 6

// Store both uploaded data URLs and retained server paths in the same ordered list.
export default function ProductPhotoManager({ photos, setPhotos, disabled = false, onReadingChange }) {
  const id = useId()
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const locked = disabled || reading
  const addPhotos = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = '' // Allow selecting the same file again after removal.
    if (!files.length) return
    setError('')
    if (photos.length + files.length > MAX_PRODUCT_PHOTOS) {
      setError('A listing can have up to 6 photos. Remove a photo before adding more.')
      return
    }
    if (files.some((file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 2.5 * 1024 * 1024)) {
      setError('Choose JPEG, PNG, or WebP photos up to 2.5 MB each.')
      return
    }
    setReading(true)
    onReadingChange?.(true)
    try {
      const added = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve({ name: file.name, data: reader.result })
        reader.onerror = reject
        reader.onabort = reject
        reader.readAsDataURL(file)
      })))
      setPhotos((current) => [...current, ...added])
    } catch {
      setError('Could not read those photos. Your existing selection has been kept.')
    } finally {
      setReading(false)
      onReadingChange?.(false)
    }
  }
  const move = (index, offset) => setPhotos((current) => {
    const updated = [...current]
    ;[updated[index], updated[index + offset]] = [updated[index + offset], updated[index]]
    return updated
  })
  return (
    <fieldset className="product-photo-manager" disabled={locked}>
      <legend>Product photos <span>{photos.length} / {MAX_PRODUCT_PHOTOS}</span></legend>
      <p id={`${id}-help`}>Add up to 6 views of your item. The first photo is the cover. JPEG, PNG or WebP, up to 2.5 MB each.</p>
      <div className="product-photo-manager-grid">
        {photos.map((photo, index) => (
          <figure key={`${photo.data}-${index}`}>
            <img src={photo.data} alt={`Product photo ${index + 1}: ${photo.name}`} />
            <figcaption>{index === 0 ? 'Cover photo' : `Photo ${index + 1}`}</figcaption>
            <div className="product-photo-actions">
              <button type="button" aria-label={`Move photo ${index + 1} earlier`} disabled={locked || index === 0} onClick={() => move(index, -1)}>←</button>
              <button type="button" aria-label={`Move photo ${index + 1} later`} disabled={locked || index === photos.length - 1} onClick={() => move(index, 1)}>→</button>
              <button type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos((current) => current.filter((_, position) => position !== index))}>Remove</button>
            </div>
          </figure>
        ))}
      </div>
      <label className="product-photo-add" htmlFor={id}>
        {reading ? 'Reading photos…' : photos.length ? '＋ Add more photos' : '＋ Choose product photos'}
        <input id={id} aria-label="Add product photos" aria-describedby={`${id}-help`} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={locked || photos.length >= MAX_PRODUCT_PHOTOS} onChange={addPhotos} />
      </label>
      {error && <p className="product-photo-error" role="alert">{error}</p>}
    </fieldset>
  )
}
