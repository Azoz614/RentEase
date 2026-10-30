// Request handling for the stateless Worker entry point. Kept free of
// `cloudflare:*` imports so it can be unit tested with Node's test runner.

const productPhoto = /^\/uploads\/products\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/
const photoTypes = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

const notFound = () => Response.json({ message: 'File not found.' }, { status: 404 })

// Product photos are public and immutable (UUID names), so they are streamed
// straight from R2 without waking the API Durable Object.
export async function serveProductPhoto(request, bucket) {
  const name = new URL(request.url).pathname.match(productPhoto)?.[1]
  if (!name || !['GET', 'HEAD'].includes(request.method)) return notFound()
  const object = await bucket.get(`products/${name}`, { onlyIf: request.headers })
  if (!object) return notFound()
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  if (!headers.has('content-type')) headers.set('content-type', photoTypes[name.split('.').pop()])
  headers.set('etag', object.httpEtag)
  headers.set('cache-control', 'public, max-age=31536000, immutable')
  headers.set('x-content-type-options', 'nosniff')
  // A matching If-None-Match makes R2 return the object metadata without a body.
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers })
  return new Response(request.method === 'HEAD' ? null : object.body, { headers })
}

// Express derives req.ip (used in audit logs) from X-Forwarded-For when trust proxy
// is enabled. Replace any client-supplied value with the address Cloudflare saw.
export function withClientAddress(request) {
  const headers = new Headers(request.headers)
  const address = request.headers.get('cf-connecting-ip')
  if (address) headers.set('x-forwarded-for', address)
  else headers.delete('x-forwarded-for')
  return new Request(request, { headers })
}

export async function handleRequest(request, env, apiServer) {
  if (new URL(request.url).pathname.startsWith('/uploads/'))
    return serveProductPhoto(request, env.MEDIA_BUCKET)
  return apiServer().fetch(withClientAddress(request))
}
