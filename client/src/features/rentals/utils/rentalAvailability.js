export function defaultRentalDates(now = new Date()) {
  const localDate = (value) =>
    new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  return { startDate: localDate(now), endDate: localDate(next) }
}

// The current local time in the "YYYY-MM-DDTHH:mm" form a datetime-local input expects.
export function localDateTimeNow(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

// Hourly bookings come from <input type="datetime-local"> with no timezone. Send them as an
// absolute instant so a server running in UTC books the hour the customer chose.
export function toServerDate(value) {
  return /T\d{2}:\d{2}/.test(value || '') && !/(Z|[+-]\d{2}:?\d{2})$/.test(value)
    ? new Date(value).toISOString()
    : value
}

export function validRentalDates(start, end) {
  return Boolean(
    start &&
    end &&
    Number.isFinite(new Date(start).getTime()) &&
    Number.isFinite(new Date(end).getTime()) &&
    new Date(end) > new Date(start),
  )
}

export function productAvailabilityLabel(product, datesValid) {
  if (product.availabilityStatus === 'on_rental') return 'Currently on rental'
  if (!datesValid) return 'Choose rental dates'
  return product.available ? 'Available' : 'Booked for these dates'
}
