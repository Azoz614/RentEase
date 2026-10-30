import { createHmac, timingSafeEqual } from 'node:crypto'
import { User } from '../users/user.model.mjs'
import { SystemSetting } from '../admin/system-setting.model.mjs'
import { point, locationError } from '../maps/location.service.mjs'
import { formatAddress } from '../identity/identity.service.mjs'
import { geoapifyKey, geoapifyRequest } from '../maps/geoapify.service.mjs'

export const mapsKey = geoapifyKey
export const DELIVERY_RATE_PER_KM = 50
export const DELIVERY_BASE_FEE = 0
export async function drivingRoute(origin, destination, geometry = false) {
  const start = point(origin).coordinates,
    end = point(destination).coordinates
  const result = await geoapifyRequest('routing', {
    waypoints: `${start[1]},${start[0]}|${end[1]},${end[0]}`,
    mode: 'drive',
    units: 'metric',
    lang: 'en',
    format: 'geojson',
  })
  const route = result.features?.[0],
    details = route?.properties
  if (
    !Number.isFinite(details?.distance) ||
    details.distance < 0 ||
    !Number.isFinite(details?.time) ||
    details.time < 0 ||
    String(details.distance_units).toLowerCase() !== 'meters'
  )
    throw locationError(422, 'No valid driving route is available for these locations.')
  let routeGeometry
  if (geometry) {
    const shape = route.geometry
    const lines =
      shape?.type === 'MultiLineString'
        ? shape.coordinates
        : shape?.type === 'LineString'
          ? [shape.coordinates]
          : []
    if (
      !Array.isArray(lines) ||
      !lines.length ||
      lines.some(
        (line) =>
          !Array.isArray(line) ||
          line.length < 2 ||
          line.some(
            (coordinate) =>
              !Array.isArray(coordinate) ||
              coordinate.length < 2 ||
              !coordinate.slice(0, 2).every(Number.isFinite) ||
              Math.abs(coordinate[0]) > 180 ||
              Math.abs(coordinate[1]) > 90,
          ),
      )
    )
      throw locationError(
        502,
        'Geoapify returned an invalid route shape. Please recalculate the route.',
      )
    routeGeometry = {
      type: 'MultiLineString',
      coordinates: lines.map((line) => line.map((coordinate) => coordinate.slice(0, 2))),
    }
  }
  // Return only the fields we use; provider response metadata may echo credentials.
  return {
    provider: 'geoapify',
    distanceKm: details.distance / 1000,
    durationSeconds: details.time,
    etaMinutes: Math.ceil(details.time / 60),
    ...(geometry ? { routeGeometry } : {}),
  }
}
export function deliveryDestination(user, input = {}) {
  if (input.destination) {
    const address =
      typeof input.destination.address === 'string' ? input.destination.address.trim() : ''
    if (address.length < 5 || address.length > 600)
      throw locationError(400, 'Confirm a complete delivery address (5–600 characters).')
    return { address, location: point(input.destination.location) }
  }
  const id = input.addressId || user.defaultAddressId
  const saved = user.addresses?.find((entry) => String(entry._id) === String(id))
  if (!saved)
    throw locationError(
      400,
      'Choose one of your saved addresses or confirm a temporary delivery location.',
    )
  const location =
    saved.location || (String(id) === String(user.defaultAddressId) ? user.addressLocation : null)
  return { address: formatAddress(saved), location: point(location) }
}
const secret = () => process.env.SESSION_SECRET || process.env.OTP_SECRET
const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url')
const cents = (amount) => {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1000000)
    throw locationError(503, 'The delivery pricing settings are invalid.')
  return Math.round(amount * 100)
}
export const fee = (distance, base, rate) => (cents(base) + Math.round(distance * cents(rate))) / 100
export async function calculateDelivery(products, destination) {
  const ids = [
    ...new Set(
      products.map((product) =>
        String(product.providerId?._id || product.providerId || product.createdBy),
      ),
    ),
  ]
  const shops = await User.find({
    _id: { $in: ids },
    active: true,
    $or: [{ role: 'admin' }, { role: 'rental_shop', shopStatus: 'approved' }],
  })
    .select('shopName username shopLocation shopAddress')
    .lean()
  if (shops.length !== ids.length || shops.some((shop) => !shop.shopLocation))
    throw locationError(
      409,
      'A rental shop has not confirmed its pickup location. Contact the shop or choose customer pickup.',
    )
  const settings = await SystemSetting.findOne({ key: 'platform' }).lean()
  const shipments = []
  // One route per real shop, regardless of the number of products in that shop.
  for (const shop of shops.sort((a, b) => String(a._id).localeCompare(String(b._id)))) {
    const route = await drivingRoute(shop.shopLocation, destination.location)
    const returnBaseFee = settings?.returnCollectionBaseFee ?? 0,
      returnPerKm = settings?.returnCollectionPerKm ?? 0
    const returnRoute =
      returnBaseFee || returnPerKm
        ? await drivingRoute(destination.location, shop.shopLocation)
        : null
    shipments.push({
      providerId: String(shop._id),
      shopName: shop.shopName || shop.username,
      shopAddress: shop.shopAddress,
      origin: point(shop.shopLocation),
      ...route,
      baseFee: DELIVERY_BASE_FEE,
      perKm: DELIVERY_RATE_PER_KM,
      fee: fee(route.distanceKm, DELIVERY_BASE_FEE, DELIVERY_RATE_PER_KM),
      returnBaseFee,
      returnPerKm,
      returnFee: returnRoute ? fee(returnRoute.distanceKm, returnBaseFee, returnPerKm) : 0,
      ...(returnRoute
        ? { returnDistanceKm: returnRoute.distanceKm, returnEtaMinutes: returnRoute.etaMinutes }
        : {}),
    })
  }
  const quotedAt = new Date()
  for (const shipment of shipments) {
    shipment.quotedAt = quotedAt
    shipment.estimatedArrivalAt = new Date(quotedAt.getTime() + shipment.durationSeconds * 1000)
  }
  const durationSeconds = Math.max(...shipments.map((item) => item.durationSeconds))
  const sum = (key) =>
    shipments.reduce((total, shipment) => total + Math.round(shipment[key] * 100), 0) / 100
  return {
    shipments,
    destination,
    distanceKm: shipments.reduce((sum, item) => sum + item.distanceKm, 0),
    etaMinutes: Math.max(...shipments.map((item) => item.etaMinutes)),
    durationSeconds,
    quotedAt,
    estimatedArrivalAt: new Date(quotedAt.getTime() + durationSeconds * 1000),
    deliveryFee: sum('fee'),
    returnCollectionFee: sum('returnFee'),
    mapsConfigured: true,
  }
}
const fingerprint = (products, destination, quote) =>
  JSON.stringify({
    products: products.map((p) => String(p._id)).sort(),
    destination,
    shipments: quote.shipments.map(
      ({
        providerId,
        provider,
        origin,
        distanceKm,
        baseFee,
        perKm,
        fee,
        returnBaseFee,
        returnPerKm,
        returnFee,
        returnDistanceKm,
      }) => ({
        providerId,
        provider,
        origin,
        distanceKm,
        baseFee,
        perKm,
        fee,
        returnBaseFee,
        returnPerKm,
        returnFee,
        returnDistanceKm,
      }),
    ),
  })
export function signQuote(user, products, quote) {
  const payload = Buffer.from(
    JSON.stringify({
      user: String(user._id),
      expires: Date.now() + 5 * 60000,
      fingerprint: fingerprint(products, quote.destination, quote),
    }),
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}
export function verifyQuoteToken(token, user) {
  try {
    if (typeof token !== 'string' || token.length > 100000) throw new Error()
    const parts = token.split('.')
    if (parts.length !== 2) throw new Error()
    const [payload, signature] = parts
    const actual = Buffer.from(signature || ''),
      expected = Buffer.from(sign(payload))
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error()
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (
      parsed.user !== String(user._id) ||
      !Number.isFinite(parsed.expires) ||
      parsed.expires < Date.now()
    )
      throw new Error()
    return parsed
  } catch {
    throw locationError(
      409,
      'Your delivery quote expired or the location or price changed. Calculate and review a new quote.',
    )
  }
}
export function validateQuote(token, user, products, destination, quote) {
  if (verifyQuoteToken(token, user).fingerprint !== fingerprint(products, destination, quote))
    throw locationError(
      409,
      'The route, location or price changed. Calculate and review a new delivery quote.',
    )
}
