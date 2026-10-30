import { randomUUID } from 'node:crypto'
import { productUploadDirectory } from '../../config/paths.js'
import { diskObjectStore } from '../../platform/object-store.mjs'

export const imageTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const contentTypes = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const storedPhoto = /^\/uploads\/products\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/

// Local disk by default; the Cloudflare Worker swaps in its R2 media bucket.
let photoStore = diskObjectStore(productUploadDirectory)
export function configureProductPhotoStore(store) {
  photoStore = store
}

const inputError = (message) => Object.assign(new Error(message), { status: 400 })

// The declared type is client-controlled; check the file's own signature as well.
const signatures = {
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
}

// Decodes one base64 data-URL photo; used by every product create and update path.
export function imageBuffer(value) {
  const match =
    typeof value === 'string' &&
    value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match || !imageTypes[match[1]]) throw inputError('Use JPEG, PNG, or WebP product photos.')
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > 2.5 * 1024 * 1024)
    throw inputError('Each photo must be 2.5 MB or smaller.')
  const extension = imageTypes[match[1]]
  if (!signatures[extension](buffer)) throw inputError('Use JPEG, PNG, or WebP product photos.')
  return { buffer, extension }
}

// Stores one validated photo and returns the public path saved on the product.
export async function writeProductPhoto({ buffer, extension }) {
  const filename = `${randomUUID()}.${extension}`
  await photoStore.put(filename, buffer, contentTypes[extension])
  return `/uploads/products/${filename}`
}

export async function readProductPhoto(filename) {
  return photoStore.get(filename)
}

export async function saveProductPhotos(values, existingPhotos) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 6)
    throw inputError('Add between 1 and 6 product photos.')
  const existing = new Set((existingPhotos || []).filter((photo) => storedPhoto.test(photo)))
  // Validate the whole selection before writing any object to disk or R2.
  const validated = values.map((value) => existing.has(value) ? value : imageBuffer(value))
  const photos = []
  const newPaths = []
  try {
    for (const value of validated) {
      if (typeof value === 'string' && existing.has(value)) {
        if (!photos.includes(value)) photos.push(value)
        continue
      }
      const savedPath = await writeProductPhoto(value)
      photos.push(savedPath)
      newPaths.push(savedPath)
    }
    if (!photos.length || photos.length > 6) throw inputError('Add between 1 and 6 product photos.')
    return { photos, newPaths }
  } catch (error) {
    await removeProductPhotos(newPaths)
    throw error
  }
}

export async function removeProductPhotos(paths) {
  await Promise.all(
    (paths || [])
      .filter((photo) => storedPhoto.test(photo))
      .map((photo) => photoStore.delete(photo.split('/').pop()).catch(() => {})),
  )
}
