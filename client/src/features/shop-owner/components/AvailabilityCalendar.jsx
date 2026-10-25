export default function AvailabilityCalendar({
  products,
  month,
  setMonth,
  productId,
  setProductId,
}) {
  const activeProducts =
    productId === 'all' ? products : products.filter((product) => product._id === productId)
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const startOffset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = Array.from(
    { length: Math.ceil((startOffset + daysInMonth) / 7) * 7 },
    (_, index) => {
      const day = index - startOffset + 1
      if (day < 1 || day > daysInMonth) return null
      const date = new Date(month.getFullYear(), month.getMonth(), day)
      const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
      const slots = activeProducts.flatMap((product) =>
        (product.rentalSlots || [])
          .filter((slot) => new Date(slot.startDate) < nextDate && new Date(slot.endDate) > date)
          .map((slot) => ({ ...slot, title: product.title })),
      )
      return { day, slots }
    },
  )
  return (
    <section className="workspace-card owner-calendar">
      <div className="workspace-card-head">
        <div>
          <small className="workspace-kicker">DATE AVAILABILITY</small>
          <h2>Rental availability calendar</h2>
          <p>Pending and accepted requests reserve the selected date range.</p>
        </div>
        <select
          aria-label="Filter availability calendar by item"
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
        >
          <option value="all">All inventory</option>
          {products.map((product) => (
            <option value={product._id} key={product._id}>
              {product.title}
            </option>
          ))}
        </select>
      </div>
      <div className="calendar-toolbar">
        <button
          aria-label="Previous month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
        >
          ←
        </button>
        <b>{month.toLocaleDateString('en', { month: 'long', year: 'numeric' })}</b>
        <button
          aria-label="Next month"
          onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
        >
          →
        </button>
      </div>
      <div className="calendar-grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
          <b className="calendar-weekday" key={day}>
            {day}
          </b>
        ))}
        {cells.map((cell, index) =>
          cell ? (
            <div
              className={`calendar-day${cell.slots.length ? ' has-booking' : ''}`}
              key={cell.day}
            >
              <b>{cell.day}</b>
              {cell.slots.slice(0, 2).map((slot) => (
                <span
                  key={`${slot.requestId}-${slot.title}`}
                  title={slot.title}
                  className={slot.status === 'accepted' ? 'accepted-slot' : ''}
                >
                  {slot.title}
                </span>
              ))}
              {cell.slots.length > 2 && <small>+{cell.slots.length - 2} more</small>}
            </div>
          ) : (
            <div className="calendar-day outside" key={`outside-${index}`} />
          ),
        )}
      </div>
      <div className="calendar-legend">
        <span>
          <i className="pending-key" />
          Pending request
        </span>
        <span>
          <i className="accepted-key" />
          Accepted booking
        </span>
      </div>
    </section>
  )
}
