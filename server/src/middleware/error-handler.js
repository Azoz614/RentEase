export const errorHandler = (error, _req, res, _next) => {
  // Body-parser errors carry a `type`; their raw messages are not meant for users.
  if (error.status === 413)
    return res.status(413).json({ message: 'The upload is too large. Reduce photo sizes and try again.' })
  if (error.type === 'entity.parse.failed')
    return res.status(400).json({ message: 'The request body contains invalid JSON.' })
  // Handlers throw Object.assign(new Error(message), { status }) for expected client errors
  // (wrong password, expired code, rate limit); keep their status and wording.
  if (!error.type && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter))
    return res.status(error.status).json({
      message: error.message,
      ...(typeof error.code === 'string' && { code: error.code }),
    })
  }
  console.error('API request failed:', error)
  res.status(500).json({ message: 'The server could not complete this request.' })
}
