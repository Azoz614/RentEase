export async function readJsonResponse(response, fallbackMessage = 'The request could not be completed.') {
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

  if (!response.ok) throw new Error(result?.message || `${fallbackMessage} (HTTP ${response.status}).`)
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error(`The server returned an unexpected response (HTTP ${response.status}).`)
  }

  return result
}
