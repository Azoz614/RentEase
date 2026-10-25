import { UiIcon } from '../../../components/ui/UiIcon.jsx'

export default function CreateListingForm({ busy, photos, setError, setPhotos, submitListing }) {
  return (
    <section className="workspace-card owner-form-card">
      <div className="workspace-card-head">
        <div>
          <small className="workspace-kicker">INVENTORY SETUP</small>
          <h2>Tell customers about the item</h2>
          <p>Clear photos and specs help customers choose the right rental.</p>
        </div>
      </div>
      <form className="owner-listing-form" onSubmit={submitListing}>
        <div className="owner-form-two">
          <label>
            Product name
            <input name="title" required maxLength="120" placeholder="e.g. Sony A7 IV camera" />
          </label>
          <label>
            Category
            <select name="category" required defaultValue="">
              <option value="" disabled>
                Select category
              </option>
              {[
                'Cameras & electronics',
                'Tools & equipment',
                'Construction',
                'Vehicles',
                'Home & garden',
                'Events & spaces',
                'Sports & travel',
                'Other',
              ].map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Description
          <textarea
            name="description"
            required
            maxLength="3000"
            rows="4"
            placeholder="Condition, what is included, pickup instructions..."
          />
        </label>
        <div className="owner-form-two">
          <label>
            Daily rental rate (LKR)
            <input name="dailyRate" type="number" min="0" step="1" required placeholder="2500" />
          </label>
          <label>
            Weekly rental rate (LKR)
            <input
              name="weeklyRate"
              type="number"
              min="0"
              step="1"
              placeholder="15000 (optional)"
            />
          </label>
          <label>
            Hourly rate (LKR)
            <input name="hourlyRate" type="number" min="0" step="1" placeholder="Optional" />
          </label>
          <label>
            Long rental discount (%)
            <input
              name="longRentalDiscountPercent"
              type="number"
              min="0"
              max="90"
              step="1"
              defaultValue="0"
            />
          </label>
          <label>
            Refundable deposit amount (LKR)
            <input name="depositAmount" type="number" min="0" step="1" defaultValue="0" />
          </label>
        </div>
        <label>
          Specifications <small>One per line, for example: Brand: Sony</small>
          <textarea
            name="specifications"
            rows="3"
            placeholder={'Brand: Sony\nModel: A7 IV\nCondition: Excellent'}
          />
        </label>
        <label className="owner-photo-input">
          <UiIcon name="upload" size={23} />
          Photos <small>Upload 1–6 JPEG, PNG or WebP images. Maximum 2.5 MB each.</small>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={async (event) => {
              const files = [...event.target.files]
              if (
                files.length > 6 ||
                files.some((file) => file.size > 2.5 * 1024 * 1024) ||
                files.reduce((sum, file) => sum + file.size, 0) > 15 * 1024 * 1024
              ) {
                setError('Choose up to 6 photos, each under 2.5 MB, with a 15 MB total.')
                setPhotos([])
                return
              }
              try {
                const result = await readPhotos(files)
                setPhotos(result)
              } catch {
                setError('Could not read the selected photos.')
              }
            }}
          />
        </label>
        {photos.length > 0 && (
          <div className="owner-photo-preview">
            {photos.map((photo, index) => (
              <figure key={index}>
                <img src={photo.data} alt={photo.name} />
                <button
                  className="re-photo-remove"
                  type="button"
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() =>
                    setPhotos((current) => current.filter((_, position) => position !== index))
                  }
                >
                  <UiIcon name="close" size={14} />
                </button>
              </figure>
            ))}
          </div>
        )}
        <div className="owner-form-note">
          Set your shop pickup location in Maps & delivery to enable nearby discovery and delivery.
          Weekly prices and discounts apply to day-based bookings. Deposits are recorded but are not
          charged until a payment provider is configured.
        </div>
        <button className="owner-primary" disabled={busy || photos.length === 0}>
          {busy ? 'Publishing listing…' : 'Publish listing'}
        </button>
      </form>
    </section>
  )
}

function readPhotos(files) {
  return Promise.all(
    [...files].map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve({ name: file.name, data: reader.result })
          reader.onerror = reject
          reader.readAsDataURL(file)
        }),
    ),
  )
}
