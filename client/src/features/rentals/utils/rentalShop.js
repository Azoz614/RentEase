// Mirrors server/src/modules/rentals/single-shop.mjs: one request holds items from one shop,
// so they are picked up together or delivered by a single rider.
export const providerOf = (product) =>
  String(product?.providerId?._id || product?.providerId || product?.createdBy || '')

export const shopNameOf = (product) =>
  product?.providerId?.shopName || product?.providerId?.username || 'RentEase'
