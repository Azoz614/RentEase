// wrangler.jsonc aliases `sharp` to this module because native image libraries
// cannot run on Workers. The Worker configures the Cloudflare Images processor
// instead (src/worker/platform.mjs), so this is never called there.
export default function sharp() {
  throw new Error('sharp is unavailable on Cloudflare Workers; use the Images binding processor.')
}
