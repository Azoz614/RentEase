// Cloudflare Worker for the RentEase web app (see wrangler.jsonc). The built SPA in
// ./dist is served by the assets binding without invoking this script; only the
// run_worker_first paths below reach it and are forwarded to the API Worker over a
// service binding, so the browser keeps using same-origin /api and /uploads URLs.
const forwarded = ['/api/', '/uploads/']

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (!forwarded.some((prefix) => pathname.startsWith(prefix))) return env.ASSETS.fetch(request)
    try {
      return await env.API.fetch(request)
    } catch (error) {
      console.error('API service binding failed:', error?.message || error)
      return Response.json(
        { message: 'The RentEase API is temporarily unavailable. Please try again shortly.' },
        { status: 502 },
      )
    }
  },
}
