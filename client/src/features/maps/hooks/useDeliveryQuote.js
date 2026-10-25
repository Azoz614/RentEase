import { useEffect, useState } from 'react'
import { position } from '../utils/coordinates.js'
import { validRentalDates } from '../../rentals/utils/rentalAvailability.js'

export default function useDeliveryQuote({
  api,
  enabled,
  productIds,
  selection,
  defaultAddress,
  startDate,
  endDate,
  billingUnit,
  couponCode,
  pricingContext,
}) {
  const [result, setResult] = useState(null)
  const [revision, setRevision] = useState(0)
  const destinationReady = selection.destination
    ? Boolean(position(selection.destination.location)) &&
      selection.destination.address?.trim().length >= 5
    : Boolean(selection.addressId || defaultAddress?.location)
  const ready =
    enabled && productIds.length > 0 && destinationReady && validRentalDates(startDate, endDate)
  const payload = JSON.stringify({
    productIds,
    ...selection,
    startDate,
    endDate,
    billingUnit,
    couponCode,
  })
  // A default-address edit must invalidate a quote even when its ID stays the same.
  const key = JSON.stringify([
    payload,
    !selection.destination ? defaultAddress : null,
    pricingContext,
  ])
  const current = ready && result?.key === key ? result : null
  const quoted = result?.quote

  useEffect(() => {
    if (!ready) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setResult({ key, loading: true })
      try {
        const quote = await api('/api/delivery/quote', {
          method: 'POST',
          body: payload,
          signal: controller.signal,
        })
        if (!controller.signal.aborted) setResult({ key, quote, loading: false })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, error: error.message, loading: false })
      }
    }, 650)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [api, key, payload, ready, revision])

  useEffect(() => {
    if (!quoted) return
    const timer = setTimeout(
      () => {
        setResult(null)
        setRevision((value) => value + 1)
      },
      Math.max(0, new Date(quoted.expiresAt).getTime() - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [quoted])

  const recalculateDelivery = () => {
    setResult(null)
    setRevision((value) => value + 1)
  }
  return {
    feeQuote: current?.quote || null,
    quoteLoading: ready && (!current || current.loading),
    quoteError: current?.error || '',
    recalculateDelivery,
  }
}
