import BookingRow from './BookingRow.jsx'

export default function ShopBookings({ busy, decide, requests }) {
  return (
    <section className="workspace-card">
      <div className="workspace-card-head">
        <div>
          <small className="workspace-kicker">CUSTOMER BOOKINGS</small>
          <h2>Review requests by item</h2>
          <p>Requests are protected against overlapping date bookings.</p>
        </div>
        <span className="booking-count">{requests.length} requests</span>
      </div>
      {requests.length ? (
        requests.map((request) => (
          <BookingRow key={request._id} request={request} decide={decide} busy={busy} expanded />
        ))
      ) : (
        <div className="workspace-empty">You do not have any booking requests yet.</div>
      )}
    </section>
  )
}
