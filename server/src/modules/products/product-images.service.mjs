import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export const imageTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const storedPhoto = /^\/uploads\/products\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/

const inputError = (message) => Object.assign(new Error(message), { status: 400 })

function imageBuffer(value) {
  const match =
    typeof value === 'string' &&
    value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match || !imageTypes[match[1]]) throw inputError('Use JPEG, PNG, or WebP product photos.')
  const buffer = Buffer.from(match[2], 'base64')
  if (!buffer.length || buffer.length > 3 * 1024 * 1024)
    throw inputError('Each photo must be smaller than 3 MB.')
  return { buffer, extension: imageTypes[match[1]] }
}

export async function saveProductPhotos(values, existingPhotos, directory) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 6)
    throw inputError('Add between 1 and 6 product photos.')
  const existing = new Set((existingPhotos || []).filter((photo) => storedPhoto.test(photo)))
  const photos = []
  const newPaths = []
  try {
    await mkdir(directory, { recursive: true })
    for (const value of values) {
      if (typeof value === 'string' && existing.has(value)) {
        if (!photos.includes(value)) photos.push(value)
        continue
      }
      const image = imageBuffer(value)
      const filename = `${randomUUID()}.${image.extension}`
      await writeFile(path.join(directory, filename), image.buffer, { flag: 'wx' })
      const savedPath = `/uploads/products/${filename}`
      photos.push(savedPath)
      newPaths.push(savedPath)
    }
    if (!photos.length || photos.length > 6) throw inputError('Add between 1 and 6 product photos.')
    return { photos, newPaths }
  } catch (error) {
    await removeProductPhotos(newPaths, directory)
    throw error
  }
}

export async function removeProductPhotos(paths, directory) {
  await Promise.all(
    (paths || [])
      .filter((photo) => storedPhoto.test(photo))
      .map((photo) => unlink(path.join(directory, path.basename(photo))).catch(() => {})),
  )
}
