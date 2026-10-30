import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { RentalArtwork } from './RentalArtwork.jsx'

export function RentalHero({ onExplore, returning = false }) {
  // Signed-in customers came to find something: a short heading keeps search and listings in view.
  if (returning)
    return (
      <section className="re-rental-heading">
        <h1>Find something to rent</h1>
      </section>
    )
  return (
    <section className="market-hero re-rental-hero">
      <div className="re-hero-copy">
        <h1>
          Rent what you need,
          <br />
          <em>when you need it.</em>
        </h1>
        <button type="button" className="re-hero-button" onClick={onExplore}>
          Explore rentals <UiIcon name="arrow" size={18} />
        </button>
        <div className="re-hero-benefits">
          <span>
            <UiIcon name="calendar" size={16} /> Daily or hourly
          </span>
          <span>
            <UiIcon name="store" size={16} /> Local shops
          </span>
          <span>
            <UiIcon name="truck" size={16} /> Pickup or delivery
          </span>
        </div>
      </div>
      <RentalArtwork />
    </section>
  )
}
