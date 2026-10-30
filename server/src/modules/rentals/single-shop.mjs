// One rental request = one shop (or the organisation's own listings), so the customer collects
// everything in one visit or a single rider delivers it all. Older multi-shop bookings still work.
export const providerOf = (product) =>
  String(product.providerId?._id || product.providerId || product.createdBy)

export const MULTIPLE_SHOPS_MESSAGE =
  'One rental request can only include items from one shop, so they can be picked up together or delivered by one rider. Send a separate request for items from another shop.'

export const fromOneShop = (products) => new Set(products.map(providerOf)).size <= 1
