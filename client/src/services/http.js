export async function readJsonResponse(
  response,
  fallbackMessage = 'The request could not be completed.',
) {
  const body = await response.text()
  let result

  try {
    result = body ? JSON.parse(body) : null
  } catch {
    const message = response.headers.get('content-type')?.includes('text/html')
      ? 'The server returned a web page instead of JSON. Check that the API server is running and the requested API route exists.'
      : `The server returned an invalid response (HTTP ${response.status}).`
    throw new Error(message)
  }

  const fallback =
    response.status === 502
      ? 'The API server is temporarily unavailable. Restart the RentEase server, wait for its database connection, then try again.'
      : `${fallbackMessage} (HTTP ${response.status}).`
  if (!response.ok)
    throw Object.assign(new Error(result?.message || fallback), {
      code: result?.code,
      status: response.status,
      retryAfter: Number(result?.retryAfter || response.headers.get('Retry-After')) || undefined,
    })
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`The server returned an unexpected response (HTTP ${response.status}).`)
  }

  return result
}

export function createApiClient(token) {
  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    })
    return readJsonResponse(response)
  }
  api.stream = async (url, signal) => {
    const response = await fetch(url, {
      signal,
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) await readJsonResponse(response)
    return response
  }
  return api
}
