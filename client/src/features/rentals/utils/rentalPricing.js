export const rentalPrice = (product, dayCount, hourCount = null) => {
  const daily = Number(product.dailyRate || 0)
  if (hourCount !== null && product.hourlyRate) return hourCount * Number(product.hourlyRate)
  const weeks = Math.floor(dayCount / 7),
    remainder = dayCount % 7
  const weekly = Number(product.weeklyRate || daily * 7)
  const base = dayCount >= 7 ? weeks * weekly + remainder * daily : dayCount * daily
  return Math.round(base * (1 - Number(product.longRentalDiscountPercent || 0) / 100))
}
