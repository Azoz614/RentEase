import sharp from 'sharp'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { encryptIdentity, decryptIdentity, identityError } from './identity-security.service.mjs'

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
      `image/${info.format}` !== match[1]
    )
      throw new Error('Invalid identity image')
    const safe = await decoder
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer()
    if (safe.length > 8 * 1024 * 1024) throw new Error('Image too large')
    return safe
  } catch {
    throw identityError(
      400,
      'INVALID_PHOTO',
      'The photo is invalid, too small or unsafe. Upload a clear JPG, PNG or WebP photograph of the card.',
    )
  }
}
export async function storeIdentityPhoto(buffer, userId, side) {
  const filename = `${randomUUID()}.bin`,
    directory = identityDirectory()
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(path.join(directory, filename), encryptIdentity(buffer, `${userId}:${side}`), {
    flag: 'wx',
    mode: 0o600,
  })
  return { filename, mime: 'image/png', size: buffer.length, uploadedAt: new Date() }
}
export async function readIdentityPhoto(document, userId, side) {
  if (!document?.filename || !/^[a-f0-9-]{36}\.bin$/.test(document.filename))
    throw identityError(404, 'DOCUMENT_NOT_FOUND', 'Identity document is not available.')
  try {
    return decryptIdentity(
      await readFile(path.join(identityDirectory(), document.filename)),
      `${userId}:${side}`,
    )
  } catch (error) {
    if (error.code === 'ENOENT')
      throw identityError(
        404,
        'DOCUMENT_NOT_FOUND',
        'Identity document is not available. Request resubmission.',
      )
    throw error
  }
}
export async function removeIdentityPhotos(documents, { strict = false } = {}) {
  for (const document of documents.filter(Boolean)) {
    if (!/^[a-f0-9-]{36}\.bin$/.test(document.filename || '')) continue
    await unlink(path.join(identityDirectory(), document.filename)).catch((error) => {
      if (error.code !== 'ENOENT') {
        if (strict) throw error
        console.error('Private identity document cleanup failed:', error.name)
      }
    })
  }
}
