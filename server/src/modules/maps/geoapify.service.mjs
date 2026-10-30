import { locationError } from './location.service.mjs'

export const geoapifyKey = () => process.env.GEOAPIFY_API_KEY?.trim()

// Keep the server key out of response objects, logs and the client bundle.
export async function geoapifyRequest(endpoint, parameters) {
  const key = geoapifyKey()
  if (!key) {
    console.warn('Geoapify is not configured: set GEOAPIFY_API_KEY in server/.env and restart.')
    throw locationError(503, 'Maps and delivery routes are temporarily unavailable. Choose self pickup or try again later.')
  }
  const url = new URL(`https://api.geoapify.com/v1/${endpoint}`)
  url.search = new URLSearchParams({ ...parameters, apiKey: key }).toString()
  let response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw locationError(502, 'Geoapify could not be reached. Please try again.')
  }
  if ([401, 403].includes(response.status))
    throw locationError(
      503,
      'Geoapify rejected the server key. Check its validity and allowed server IP addresses.',
    )
  if (response.status === 429)
    throw locationError(503, 'The Geoapify request limit has been reached. Please try again later.')
  if (!response.ok)
    throw locationError(
      response.status === 400 || response.status === 404 ? 422 : 502,
      'Geoapify could not find a result for these locations. Try another location or retry later.',
    )
  try {
    return await response.json()
  } catch {
    throw locationError(502, 'Geoapify returned an invalid response. Please try again.')
  }
}
