export function verificationError(error, _req, res, _next) {
  if (error.retryAfter) res.set('Retry-After', String(error.retryAfter))
  if (!error.status) console.error('Rental workflow failed:', error.name)
  res.status(error.status || 500).json({
    code: typeof error.code === 'string' ? error.code : 'WORKFLOW_FAILED',
    message: error.status ? error.message : 'Could not update this rental. Refresh and try again.',
    ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
  })
}
