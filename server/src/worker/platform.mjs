import { configureProductPhotoStore } from '../modules/products/product-images.service.mjs'
import { configureIdentityDocuments } from '../modules/identity/identity-documents.service.mjs'
import { configureSmtpSockets } from '../config/mailer.js'
import { r2ObjectStore } from '../platform/object-store.mjs'
import { cloudflareIdentityPhotoProcessor } from './cloudflare-images.mjs'
import { smtpSocketByHostname } from './smtp-socket.mjs'

// Replaces the Node defaults (local disk, sharp, nodemailer's own sockets) with
// Cloudflare bindings and runtime-compatible sockets.
export function configureCloudflarePlatform(env) {
  configureProductPhotoStore(r2ObjectStore(env.MEDIA_BUCKET, 'products/'))
  configureIdentityDocuments({
    store: r2ObjectStore(env.IDENTITY_BUCKET, 'identity-v2/'),
    processPhoto: cloudflareIdentityPhotoProcessor(env.IMAGES),
  })
  configureSmtpSockets(smtpSocketByHostname)
}
