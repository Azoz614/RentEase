import { Coupon } from './coupon.model.mjs'

export async function priceCoupon(codeValue, subtotal) {
  const code = typeof codeValue === 'string' ? codeValue.trim().toUpperCase() : ''
  if (!code) return { coupon: null, discountAmount: 0 }
  const coupon = await Coupon.findOne({
    code,
    active: true,
    startsAt: { $lte: new Date() },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  })
  if (!coupon || (coupon.maxRedemptions && coupon.redemptionCount >= coupon.maxRedemptions))
    throw new Error('This coupon is invalid, expired, or fully redeemed.')
  if (subtotal < coupon.minimumSubtotal)
    throw new Error(
      `This coupon requires a rental subtotal of at least LKR ${coupon.minimumSubtotal.toLocaleString()}.`,
    )
  let discountAmount = coupon.kind === 'percent' ? (subtotal * coupon.value) / 100 : coupon.value
  if (coupon.maximumDiscount != null)
    discountAmount = Math.min(discountAmount, coupon.maximumDiscount)
  discountAmount = Math.min(subtotal, Math.round(discountAmount))
  return { coupon, discountAmount }
}

// A cancelled or fully declined booking gives its coupon use back, so limited coupons are not
// used up by bookings that never happened.
export async function releaseCoupon(codeValue, session) {
  const code = typeof codeValue === 'string' ? codeValue.trim().toUpperCase() : ''
  if (!code) return
  await Coupon.updateOne({ code, redemptionCount: { $gt: 0 } }, { $inc: { redemptionCount: -1 } }, { session })
}
