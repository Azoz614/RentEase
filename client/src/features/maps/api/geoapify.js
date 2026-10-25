export const geoapifyBrowserKey = () => import.meta.env.VITE_GEOAPIFY_API_KEY?.trim()

export async function geoapifySearch(endpoint, parameters, signal) {
  const key = geoapifyBrowserKey()
  if (!key)
    throw new Error(
      'Address search needs VITE_GEOAPIFY_API_KEY in client/.env. Add your Geoapify browser key and restart the frontend.',
    )
  const url = new URL(`https://api.geoapify.com/v1/geocode/${endpoint}`)
  url.search = new URLSearchParams({
    ...parameters,
    format: 'json',
    lang: 'en',
    apiKey: key,
  }).toString()
  let response
  const timeout = AbortSignal.timeout(12000)
  try {
    response = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Geoapify could not be reached. Check your connection and retry.')
  }
  if ([401, 403].includes(response.status))
    throw new Error('Geoapify rejected the browser key. Check the key and its allowed websites.')
  if (response.status === 429)
    throw new Error('The Geoapify request limit has been reached. Please try again later.')
  if (!response.ok)
    throw new Error('Address lookup is unavailable. Enter the address and choose a pin manually.')
  let result
  try {
    result = await response.json()
  } catch {
    throw new Error('Geoapify returned an invalid address response. Please retry.')
  }
  if (!Array.isArray(result.results))
    throw new Error('Geoapify returned an invalid address response. Please retry.')
  return result.results.filter(
    (entry) =>
      Number.isFinite(entry.lat) &&
      Number.isFinite(entry.lon) &&
      Math.abs(entry.lat) <= 90 &&
      Math.abs(entry.lon) <= 180,
  )
}
