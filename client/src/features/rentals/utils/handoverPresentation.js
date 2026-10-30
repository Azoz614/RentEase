export const labels = {
  pending: 'Pending approval',
  confirmed: 'Booked',
  active: 'Renting',
  return_in_transit: 'Return in transit',
  returned: 'Returned',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
}

export const date = (value) =>
  value
    ? new Date(value).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not yet verified'

export const shortId = (id) => `#${String(id).slice(-8).toUpperCase()}`
