import { fileURLToPath } from 'node:url'

// Local-disk upload directories for the Node server. Resolved lazily because the
// Cloudflare Worker bundle has no file: module URLs (it stores uploads in R2).
export const uploadsDirectory = () => fileURLToPath(new URL('../../uploads', import.meta.url))

export const productUploadDirectory = () =>
  fileURLToPath(new URL('../../uploads/products', import.meta.url))
