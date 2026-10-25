import { fileURLToPath } from 'node:url'

export const productUploadDirectory = fileURLToPath(
  new URL('../../uploads/products', import.meta.url),
)
