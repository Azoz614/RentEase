import { locationError } from '../maps/location.service.mjs'

export function rentalPeriod(startValue, endValue, billingUnit) {
  const start = new Date(startValue),
    end = new Date(endValue)
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end ||
    start < new Date(new Date().setHours(0, 0, 0, 0))
  )
    throw locationError(400, 'Choose valid rental start and end dates.')
  return {
    dayCount: Math.ceil((end - start) / 86400000),
    billableHours: Math.ceil((end - start) / 3600000),
    billingUnit: billingUnit === 'hour' ? 'hour' : 'day',
  }
}

export function rentalAmount(product, { dayCount, billableHours, billingUnit }) {
  const daily = Number(product.dailyRate || 0)
  if (billingUnit === 'hour' && product.hourlyRate)
    return billableHours * Number(product.hourlyRate)
  const weekly = Number(product.weeklyRate || daily * 7)
  const weeks = Math.floor(dayCount / 7),
    remainingDays = dayCount % 7
  const base = dayCount >= 7 ? weeks * weekly + remainingDays * daily : dayCount * daily
  return Math.round(base * (1 - Number(product.longRentalDiscountPercent || 0) / 100))
}
