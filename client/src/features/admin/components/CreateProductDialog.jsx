import { useState } from 'react'
import ProductPhotoManager from '../../products/components/ProductPhotoManager.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'

export default function CreateProductDialog({
  busy,
  newItemType,
  photos,
  setAddItemOpen,
  setNewItemType,
  setPhotos,
  submitProduct,
  users,
}) {
  const [readingPhotos, setReadingPhotos] = useState(false)
  return (
    <div
      className="admin-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setAddItemOpen(false)
          setNewItemType('')
          setPhotos([])
        }
      }}
    >
      <section
        className="admin-modal admin-add-item-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-item-title"
      >
        <div className="admin-card-heading">
          <div>
            <span className="admin-kicker">NEW RENTAL ITEM</span>
            <h2 id="add-item-title">
              {newItemType ? `Enter ${newItemType} details` : 'What would you like to add?'}
            </h2>
          </div>
          <button
            type="button"
            className="admin-modal-close"
            aria-label="Close"
            onClick={() => {
              setAddItemOpen(false)
              setNewItemType('')
              setPhotos([])
            }}
          >
            ×
          </button>
        </div>
        {!newItemType ? (
          <div className="admin-item-type-picker">
            <button type="button" onClick={() => setNewItemType('vehicle')}>
              <span>
                <UiIcon name="truck" size={23} />
              </span>
              <b>Vehicle</b>
              <small>Cars, vans, motorcycles, and other transport.</small>
            </button>
            <button type="button" onClick={() => setNewItemType('asset')}>
              <span>
                <UiIcon name="box" size={23} />
              </span>
              <b>Asset</b>
              <small>Equipment, tools, cameras, and other rentable assets.</small>
            </button>
          </div>
        ) : (
          <form className="admin-form" onSubmit={submitProduct}>
            <button
              type="button"
              className="admin-text-button admin-change-type"
              onClick={() => setNewItemType('')}
            >
              Change item type
            </button>
            <label>
              {newItemType === 'vehicle' ? 'Vehicle name' : 'Asset name'}
              <input
                name="title"
                placeholder={
                  newItemType === 'vehicle' ? 'e.g. Toyota Axio 2018' : 'e.g. Canon EOS R6 camera'
                }
                maxLength="120"
                required
              />
            </label>
            {newItemType === 'vehicle' ? (
              <>
                <div className="admin-form-row">
                  <label>
                    Make
                    <input name="make" placeholder="Toyota" required />
                  </label>
                  <label>
                    Model
                    <input name="model" placeholder="Axio" required />
                  </label>
                </div>
                <div className="admin-form-row">
                  <label>
                    Registration number
                    <input name="registration" placeholder="ABC-1234" required />
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
                  <input name="seats" type="number" min="1" max="100" placeholder="5" required />
                </label>
              </>
            ) : (
              <>
                <div className="admin-form-row">
                  <label>
                    Asset category
                    <input name="assetCategory" placeholder="Camera equipment" required />
                  </label>
                  <label>
                    Brand / model
                    <input name="brandModel" placeholder="Canon EOS R6" required />
                  </label>
                </div>
                <div className="admin-form-row">
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
              </>
            )}
            <div className="admin-form-row">
              <label>
                Daily rental rate (LKR)
                <input
                  name="dailyRate"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="2500"
                  required
                />
              </label>
              <label>
                Preparation lead time (hours)
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
                rows="4"
                maxLength="3000"
                placeholder="Describe the item, condition, and what is included."
                required
              />
            </label>
            <label>
              Rental provider
              <select name="providerId" defaultValue="">
                <option value="">RentEase admin (default)</option>
                {users
                  .filter(
                    (account) =>
                      account.role === 'rental_shop' &&
                      account.active &&
                      account.shopStatus === 'approved',
                  )
                  .map((shop) => (
                    <option key={shop._id} value={shop._id}>
                      {shop.shopName || shop.username}
                    </option>
                  ))}
              </select>
            </label>
            <ProductPhotoManager photos={photos} setPhotos={setPhotos} disabled={busy} onReadingChange={setReadingPhotos} />
            <button className="admin-primary" type="submit" disabled={busy || readingPhotos || !photos.length}>
              {busy ? 'Publishing...' : 'Publish item'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
