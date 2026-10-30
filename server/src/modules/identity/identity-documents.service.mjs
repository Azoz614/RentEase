import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { encryptIdentity, decryptIdentity, identityError } from './identity-security.service.mjs'
import { diskObjectStore } from '../../platform/object-store.mjs'

export const identityDirectory = () => {
  const directory = path.resolve(
    process.env.IDENTITY_STORAGE_DIR ||
      fileURLToPath(new URL('../../../private/identity-v2', import.meta.url)),
  )
  const publicDirectories = [
    '../../../uploads',
    '../../../../client/public',
    '../../../../client/dist',
  ].map((relative) => path.resolve(fileURLToPath(new URL(relative, import.meta.url))))
  if (
    publicDirectories.some(
      (publicPath) => directory === publicPath || directory.startsWith(publicPath + path.sep),
    )
  )
    throw identityError(
      503,
      'UNSAFE_IDENTITY_STORAGE',
      'Identity storage must be outside every public/static directory.',
    )
  return directory
}

// Decodes, validates and re-encodes a card photo as PNG, discarding metadata.
async function sharpIdentityPhoto(buffer, mime) {
  const decoder = sharp(buffer, {
    limitInputPixels: 20_000_000,
    failOn: 'warning',
    animated: false,
  })
  const info = await decoder.metadata()
  if (
    !['jpeg', 'png', 'webp'].includes(info.format) ||
    (info.pages || 1) !== 1 ||
    info.width < 200 ||
    info.height < 120 ||
    `image/${info.format}` !== mime
  )
    throw new Error('Invalid identity image')
  return decoder
    .rotate()
    .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer()
}

// Node defaults: private disk directory and sharp. The Cloudflare Worker swaps in
// its private R2 bucket and the Images binding (sharp cannot run on Workers).
let documentStore = diskObjectStore(identityDirectory, { directoryMode: 0o700, fileMode: 0o600 })
let normalizePhoto = sharpIdentityPhoto
export function configureIdentityDocuments({ store, processPhoto } = {}) {
  if (store) documentStore = store
  if (processPhoto) normalizePhoto = processPhoto
}

export async function prepareIdentityPhoto(data) {
  const match =
    typeof data === 'string' &&
    data.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match || match[2].length > 4 * 1024 * 1024)
    throw identityError(
      400,
      'INVALID_PHOTO',
      'Use a clear JPG, PNG or WebP image no larger than 3 MB.',
    )
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > 3 * 1024 * 1024)
    throw identityError(400, 'INVALID_PHOTO', 'Each photo must be no larger than 3 MB.')
  try {
    const safe = await normalizePhoto(buffer, match[1])
    if (safe.length > 8 * 1024 * 1024) throw new Error('Image too large')
    return safe
  } catch (error) {
    // Processors flag infrastructure failures with a status so they are not
    // reported to the customer as a bad photo.
    if (error?.status) throw error
    throw identityError(
      400,
      'INVALID_PHOTO',
      'The photo is invalid, too small or unsafe. Upload a clear JPG, PNG or WebP photograph of the card.',
    )
  }
}
export async function storeIdentityPhoto(buffer, userId, side) {
  const filename = `${randomUUID()}.bin`
  await documentStore.put(
    filename,
    encryptIdentity(buffer, `${userId}:${side}`),
    'application/octet-stream',
  )
  return { filename, mime: 'image/png', size: buffer.length, uploadedAt: new Date() }
}
export async function readIdentityPhoto(document, userId, side) {
  if (!document?.filename || !/^[a-f0-9-]{36}\.bin$/.test(document.filename))
    throw identityError(404, 'DOCUMENT_NOT_FOUND', 'Identity document is not available.')
  const encrypted = await documentStore.get(document.filename)
  if (!encrypted)
    throw identityError(
      404,
      'DOCUMENT_NOT_FOUND',
      'Identity document is not available. Request resubmission.',
    )
  return decryptIdentity(encrypted, `${userId}:${side}`)
}
export async function removeIdentityPhotos(documents, { strict = false } = {}) {
  for (const document of documents.filter(Boolean)) {
    if (!/^[a-f0-9-]{36}\.bin$/.test(document.filename || '')) continue
    await documentStore.delete(document.filename).catch((error) => {
      if (strict) throw error
      console.error('Private identity document cleanup failed:', error.name)
    })
  }
}
