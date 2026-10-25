import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { RentalArtwork } from './RentalArtwork.jsx'

export function RentalHero({ onExplore, returning = false }) {
  return (
    <section className="market-hero re-rental-hero">
      <div className="re-hero-copy">
        <span className="market-kicker">
          <span className="re-live-dot" /> GOOD THINGS ARE CLOSER THAN YOU THINK
        </span>
        <h1>
          {returning ? (
            <>
              Your next plan.
              <br />
              <em>We have the gear.</em>
            </>
          ) : (
            <>
              More possibilities.
              <br />
              <em>Less to own.</em>
            </>
          )}
        </h1>
        <p>
          From weekend projects to your next big adventure. Find the gear you need, from people and
          shops nearby.
        </p>
        <button type="button" className="re-hero-button" onClick={onExplore}>
          Explore rentals <UiIcon name="arrow" size={18} />
        </button>
        <div className="re-hero-benefits">
          <span>
            <UiIcon name="calendar" size={16} /> Flexible rental dates
          </span>
          <span>
            <UiIcon name="store" size={16} /> Local shops
          </span>
          <span>
            <UiIcon name="truck" size={16} /> Delivery options
          </span>
        </div>
      </div>
      <RentalArtwork />
    </section>
  )
}
