export const publicRequest = (request) => (request.toObject ? request.toObject() : request)

export const canManageRequest = (request, user) =>
  user.role === 'admin' ||
  request.items.some((item) => String(item.providerId) === String(user._id))

export function changeStatus(request, status, user, note = '') {
  const transitions = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['active', 'cancelled', 'disputed'],
    active: ['returned', 'disputed'],
    return_in_transit: ['disputed'],
    returned: ['completed', 'disputed'],
    completed: [],
    cancelled: [],
    disputed: ['completed', 'cancelled'],
  }
  if (!transitions[request.status || 'pending']?.includes(status))
    throw Object.assign(
      new Error(`This booking cannot move from ${request.status || 'pending'} to ${status}.`),
      { status: 409 },
    )
  request.status = status
  request.statusHistory.push({ status, by: user._id, note })
}
