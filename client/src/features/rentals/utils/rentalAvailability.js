export function defaultRentalDates(now = new Date()) {
  const localDate = (value) =>
    new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  return { startDate: localDate(now), endDate: localDate(next) }
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
