import { useState } from 'react'
import ProductPhotoManager from '../../products/components/ProductPhotoManager.jsx'
import { Modal } from '../../rentals/components/Modal.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'

// Vehicles are listed under "Vehicles"; assets pick one of these catalog categories.
const assetCategories = [
  'Cameras & electronics',
  'Tools & equipment',
  'Construction',
  'Home & garden',
  'Events & spaces',
  'Sports & travel',
  'Other',
]

// Like the admin's add-item dialog: choose Vehicle or Asset first, then fill in that type's
// details. submitListing(event, itemType) publishes the listing.
export default function AddListingDialog({
  busy,
  error,
  photos,
  setPhotos,
  submitListing,
  onClose,
}) {
  const [itemType, setItemType] = useState('')
  const [readingPhotos, setReadingPhotos] = useState(false)
  const vehicle = itemType === 'vehicle'
  const close = () => {
    if (!busy && !readingPhotos) onClose()
  }
  return (
    <Modal titleId="add-listing-title" className="owner-add-listing" onClose={close}>
      <div className="owner-add-listing-head">
        <div>
          <small className="workspace-kicker">NEW RENTAL ITEM</small>
          <h2 id="add-listing-title">
            {itemType ? `Enter ${itemType} details` : 'What would you like to add?'}
          </h2>
        </div>
        <button type="button" className="owner-add-listing-close" aria-label="Close" onClick={close}>
          <UiIcon name="close" size={18} />
        </button>
      </div>
      {!itemType ? (
        <div className="owner-type-picker">
          <button type="button" onClick={() => setItemType('vehicle')}>
            <span>
              <UiIcon name="truck" size={23} />
            </span>
            <b>Vehicle</b>
            <small>Cars, vans, motorcycles, and other transport.</small>
          </button>
          <button type="button" onClick={() => setItemType('asset')}>
            <span>
              <UiIcon name="box" size={23} />
            </span>
            <b>Asset</b>
            <small>Equipment, tools, cameras, and other rentable assets.</small>
          </button>
        </div>
      ) : (
        <form className="owner-listing-form" onSubmit={(event) => submitListing(event, itemType)}>
          <button
            type="button"
            className="owner-change-type"
            disabled={busy}
            onClick={() => setItemType('')}
          >
            Change item type
          </button>
          <label>
            {vehicle ? 'Vehicle name' : 'Asset name'}
            <input
              name="title"
              required
              maxLength="120"
              placeholder={vehicle ? 'e.g. Toyota Axio 2018' : 'e.g. Canon EOS R6 camera'}
            />
          </label>
          {vehicle ? (
            <>
              <div className="owner-form-two">
                <label>
                  Make
                  <input name="make" required placeholder="Toyota" />
                </label>
                <label>
                  Model
                  <input name="model" required placeholder="Axio" />
                </label>
                <label>
                  Registration number
                  <input name="registration" required placeholder="ABC-1234" />
                </label>
                <label>
                  Fuel type
                  <select name="fuelType" defaultValue="Petrol" required>
                    <option>Petrol</option>
                    <option>Diesel</option>
                    <option>Hybrid</option>
                    <option>Electric</option>
                  </select>
                </label>
              </div>
              <label>
                Number of seats
                <input name="seats" type="number" min="1" max="100" required placeholder="5" />
              </label>
            </>
          ) : (
            <div className="owner-form-two">
              <label>
                Category
                <select name="category" required defaultValue="">
                  <option value="" disabled>
                    Select category
                  </option>
                  {assetCategories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>
              <label>
                Brand / model
                <input name="brandModel" required placeholder="Canon EOS R6" />
              </label>
              <label>
                Condition
                <select name="condition" defaultValue="Excellent" required>
                  <option>Excellent</option>
                  <option>Good</option>
                  <option>Fair</option>
                </select>
              </label>
              <label>
                Asset ID <small>Optional</small>
                <input name="assetId" placeholder="ASSET-001" />
              </label>
            </div>
          )}
          <div className="owner-form-two">
            <label>
              Daily rental rate (LKR)
              <input name="dailyRate" type="number" min="0" step="1" required placeholder="2500" />
            </label>
            <label>
              Weekly rental rate (LKR) <small>Optional</small>
              <input name="weeklyRate" type="number" min="0" step="1" placeholder="15000" />
            </label>
            <label>
              Hourly rate (LKR) <small>Optional</small>
              <input name="hourlyRate" type="number" min="0" step="1" placeholder="500" />
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
              Refundable deposit (LKR)
              <input name="depositAmount" type="number" min="0" step="1" defaultValue="0" />
            </label>
            <label>
              Preparation time (hours)
              <input
                name="leadTimeHours"
                type="number"
                min="0"
                max="720"
                step="1"
                defaultValue="24"
                required
              />
            </label>
          </div>
          <label>
            Description
            <textarea
              name="description"
              required
              maxLength="3000"
              rows="4"
              placeholder="Condition, what is included, pickup instructions…"
            />
          </label>
          <label>
            More specifications <small>Optional, one per line, for example: Colour: White</small>
            <textarea name="specifications" rows="2" placeholder={'Colour: White\nMileage: 45,000 km'} />
          </label>
          <ProductPhotoManager
            photos={photos}
            setPhotos={setPhotos}
            disabled={busy}
            onReadingChange={setReadingPhotos}
          />
          <div className="owner-form-note">
            Set your shop pickup location in Maps & delivery to enable nearby discovery and delivery.
            Weekly prices and discounts apply to day-based bookings. Deposits are recorded but are not
            charged until a payment provider is configured.
          </div>
          {error && (
            <p className="owner-add-listing-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="owner-primary"
            disabled={busy || readingPhotos || photos.length === 0}
          >
            {busy ? 'Publishing listing…' : 'Publish listing'}
          </button>
        </form>
      )}
    </Modal>
  )
}
