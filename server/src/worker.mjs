// Cloudflare Workers entry point for the RentEase API (see wrangler.jsonc).
// Local development and tests still use src/server.js on Node.
import { handleRequest } from './worker/router.mjs'

export { ApiServer } from './worker/api-server.mjs'

// Every request goes to one named Durable Object so all traffic shares one
// MongoDB connection pool. The location hint (first creation only) should be the
// Cloudflare region nearest the Atlas cluster.
const apiServer = (env) =>
  env.API_SERVER.get(env.API_SERVER.idFromName('primary'), {
    ...(env.API_LOCATION_HINT && { locationHint: env.API_LOCATION_HINT }),
  })

export default {
  fetch(request, env) {
    return handleRequest(request, env, () => apiServer(env))
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(apiServer(env).runScheduled(controller.cron))
  },
}
