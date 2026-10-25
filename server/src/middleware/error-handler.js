export const errorHandler = (error, _req, res, _next) => {
  console.error('API request failed:', error)
  const status = error.status === 413 ? 413 : error.type === 'entity.parse.failed' ? 400 : 500
  const message =
    status === 413
      ? 'The upload is too large. Reduce photo sizes and try again.'
      : status === 400
        ? 'The request body contains invalid JSON.'
        : 'The server could not complete this request.'
  res.status(status).json({ message })
}
