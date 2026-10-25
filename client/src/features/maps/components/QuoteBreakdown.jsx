import { formatCurrencyFixed as money } from '../../../utils/currency.js'

const travelTime = (minutes) =>
  minutes >= 60
    ? Math.floor(minutes / 60) + ' hr' + (minutes % 60 ? ' ' + (minutes % 60) + ' min' : '')
    : minutes + ' min'

export function QuoteBreakdown({ quote }) {
  if (!quote) return null
  return (
    <section className="checkout-route-summary" aria-live="polite">
      <dl className="checkout-route-metrics">
        <div>
          <dt>Driving distance</dt>
          <dd>{quote.distanceKm.toFixed(2)} km</dd>
        </div>
        <div>
          <dt>Estimated travel time</dt>
          <dd>{travelTime(quote.etaMinutes)}</dd>
        </div>
        <div>
          <dt>Estimated arrival time</dt>
          <dd>
            {quote.estimatedArrivalAt
              ? new Date(quote.estimatedArrivalAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })
              : 'Unavailable'}
          </dd>
        </div>
      </dl>
      <small className="fee-note">
        Estimate if departing when quoted; not a guaranteed delivery time. Dispatch depends on
        approval and pickup.
        {quote.shipments?.length > 1 &&
          ' Distance totals all shop routes; travel time shows the longest route.'}
      </small>
      <details className="checkout-shop-routes">
        <summary>Shop routes and fees</summary>
        {quote.shipments?.map((shipment) => (
          <div key={shipment.providerId}>
            <b>{shipment.shopName}</b>
            <p>
              {shipment.distanceKm.toFixed(2)} km × Rs. 50/km = {money(shipment.fee)}
            </p>
            <small>Estimated travel: {travelTime(shipment.etaMinutes)}</small>
            {shipment.returnDistanceKm != null && (
              <p>
                Return collection: {shipment.returnDistanceKm.toFixed(2)} km ·{' '}
                {money(shipment.returnFee)}
              </p>
            )}
          </div>
        ))}
      </details>
      <small className="re-map-attribution">
        Driving routes by{' '}
        <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">
          Geoapify
        </a>
        . Quote valid until {new Date(quote.expiresAt).toLocaleTimeString()}. Rechecked at
        confirmation.
      </small>
    </section>
  )
}
