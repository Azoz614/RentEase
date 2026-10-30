import { CommissionEntry } from './commission.model.mjs'
import { User } from '../users/user.model.mjs'

const fail = (message) => Object.assign(new Error(message), { status: 409 })
export function minor(value) {
  const amount = Number(value)
  const cents = Math.round((amount + Number.EPSILON) * 100)
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents)) throw fail('The payment amount is invalid.')
  return cents
}
export function commissionAmounts(grossMinor, rateBasisPoints) {
  if (!Number.isSafeInteger(grossMinor) || grossMinor < 0 || !Number.isSafeInteger(grossMinor * rateBasisPoints)) throw fail('The payment amount is too large.')
  const commissionMinor = Math.floor((grossMinor * rateBasisPoints + 5000) / 10000)
  return { grossMinor, commissionMinor, netMinor: grossMinor - commissionMinor, rateBasisPoints }
}

// Allocate the coupon across every provider, including organization-owned items,
// using largest remainders so the rounded shares add up to the exact paid subtotal.
export function rentalShares(rental) {
  const groups = new Map()
  for (const item of rental.items) {
    const key = String(item.providerId)
    const group = groups.get(key) || { providerId: item.providerId, role: item.providerRole, gross: 0 }
    group.gross += minor(item.rentalAmount || 0); groups.set(key, group)
  }
  const rows = [...groups.values()].sort((a, b) => String(a.providerId).localeCompare(String(b.providerId)))
  const total = rows.reduce((sum, row) => sum + row.gross, 0), discount = Math.min(total, minor(rental.discountAmount || 0))
  if (!Number.isSafeInteger(total)) throw fail('The payment amount is too large.')
  if (!total) return rows.map((row) => ({ ...row, grossMinor: 0 }))
  const paid = total - discount
  const shares = rows.map((row) => ({ ...row, grossMinor: Number(BigInt(row.gross) * BigInt(paid) / BigInt(total)), remainder: BigInt(row.gross) * BigInt(paid) % BigInt(total) }))
  let remainder = paid - shares.reduce((sum, row) => sum + row.grossMinor, 0)
  for (const row of [...shares].sort((a, b) => a.remainder === b.remainder ? String(a.providerId).localeCompare(String(b.providerId)) : a.remainder > b.remainder ? -1 : 1)) {
    if (!remainder) break
    row.grossMinor += 1; remainder -= 1
  }
  return shares
}
export async function recordRentalCommissions(rental, session) {
  const shares = rentalShares(rental)
  const providers = await User.find({ _id: { $in: shares.map((row) => row.providerId) } }).select('role').session(session).lean()
  for (const row of shares) {
    const role = row.role || providers.find((user) => String(user._id) === String(row.providerId))?.role
    if (role !== 'rental_shop' || !row.grossMinor) continue
    await CommissionEntry.updateOne({ _id: `rental:${rental._id}:${row.providerId}` }, { $setOnInsert: {
      kind: 'rental', rentalId: rental._id, beneficiaryId: row.providerId,
      ...commissionAmounts(row.grossMinor, 500), paymentProvider: rental.payment.provider, status: 'pending',
    } }, { session, upsert: true, runValidators: true })
  }
}
export async function earnRentalCommissions(rental, session) {
  await CommissionEntry.updateMany({ rentalId: rental._id, kind: 'rental', status: 'pending' },
    { $set: { status: 'earned', earnedAt: new Date() } }, { session })
}
export async function recordDeliveryCommission(task, rental, session) {
  if (rental.commissionVersion !== 1 || !task.assignedPartner ||
    !['delivered', 'returned'].includes(task.status) || !task.completedAt ||
    ['unpaid', 'failed'].includes(rental.payment?.status) || rental.status === 'cancelled') return
  const amount = minor(task.fee || 0)
  if (!amount) return
  await CommissionEntry.updateOne({ _id: `delivery:${task._id}` }, { $setOnInsert: {
    kind: 'delivery', rentalId: rental._id, deliveryTaskId: task._id,
    beneficiaryId: task.assignedPartner, direction: task.direction,
    ...commissionAmounts(amount, 100), status: 'earned', earnedAt: task.completedAt,
    paymentProvider: rental.payment.provider,
  } }, { session, upsert: true, runValidators: true })
}
export async function reverseRentalCommissions(rentalId, session) {
  // Cancellation reverses the shop allocations, never simulates a real gateway refund.
  // Completed delivery trips stay earned: the partner did the work.
  await CommissionEntry.updateMany({ rentalId, kind: 'rental', status: { $ne: 'reversed' } }, [{ $set: {
    status: 'reversed', refundedGrossMinor: '$grossMinor', reversedCommissionMinor: '$commissionMinor', updatedAt: new Date(),
  } }], { session, updatePipeline: true })
}

export async function commissionReport({ beneficiaryId, kind, status, from, to, page = 1 } = {}) {
  const query = { ...(beneficiaryId && { beneficiaryId }), ...(kind && { kind }), ...(status && { status }) }
  if (from || to) {
    // Earned commission belongs to the period it was earned in; pending entries to when they were booked.
    const range = { ...(from && { $gte: from }), ...(to && { $lte: to }) }
    query.$or = [{ earnedAt: range }, { earnedAt: { $exists: false }, createdAt: range }]
  }
  const [summary, entries, total] = await Promise.all([
    CommissionEntry.aggregate([{ $match: query }, { $group: {
      _id: '$kind', grossMinor: { $sum: { $subtract: ['$grossMinor', '$refundedGrossMinor'] } },
      commissionMinor: { $sum: { $subtract: ['$commissionMinor', '$reversedCommissionMinor'] } },
      netMinor: { $sum: { $subtract: [{ $subtract: ['$grossMinor', '$refundedGrossMinor'] }, { $subtract: ['$commissionMinor', '$reversedCommissionMinor'] }] } },
      earnedMinor: { $sum: { $cond: [{ $in: ['$status', ['earned', 'settled']] }, { $subtract: ['$commissionMinor', '$reversedCommissionMinor'] }, 0] } },
      pendingMinor: { $sum: { $cond: [{ $in: ['$status', ['pending', 'earned']] }, { $subtract: ['$commissionMinor', '$reversedCommissionMinor'] }, 0] } },
      settledMinor: { $sum: { $cond: [{ $eq: ['$status', 'settled'] }, { $subtract: ['$commissionMinor', '$reversedCommissionMinor'] }, 0] } },
    } }]),
    CommissionEntry.find(query).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * 30).limit(30).lean(),
    CommissionEntry.countDocuments(query),
  ])
  const blank = { grossMinor: 0, commissionMinor: 0, netMinor: 0, earnedMinor: 0, pendingMinor: 0, settledMinor: 0 }
  return { rental: summary.find((row) => row._id === 'rental') || blank, delivery: summary.find((row) => row._id === 'delivery') || blank,
    entries, total, page, pages: Math.ceil(total / 30), currency: 'LKR', ledgerOnly: true,
    settlementNote: 'Allocations are ledger records. No payout gateway is connected; funds are not transferred by this dashboard.' }
}
