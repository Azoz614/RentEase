// Identity photo processing on Workers, via the Cloudflare Images binding. It applies
// the same rules as the sharp processor used on Node: JPEG/PNG/WebP matching the
// declared type, at least 200x120, at most 20 MP, first frame only, EXIF rotation
// applied, fitted inside 2400x2400 without enlarging, re-encoded as PNG (which
// discards all metadata).
const MAX_PIXELS = 20_000_000

const unavailable = () =>
  Object.assign(
    new Error('Identity photo processing is temporarily unavailable. Please try again shortly.'),
    { status: 503, code: 'IMAGE_PROCESSING_UNAVAILABLE' },
  )

// info() reports the format as a MIME type; accept a bare name defensively too.
const mimeType = (format) => {
  const value = String(format || '').toLowerCase()
  if (value.startsWith('image/')) return value
  return `image/${value === 'jpg' ? 'jpeg' : value}`
}

const stream = (buffer) => new Blob([buffer]).stream()

export function cloudflareIdentityPhotoProcessor(images) {
  return async (buffer, mime) => {
    if (!images) throw unavailable()
    // Undecodable input makes info() throw, which is reported as an invalid photo.
    const info = await images.info(stream(buffer))
    if (
      mimeType(info?.format) !== mime ||
      !(info.width >= 200) ||
      !(info.height >= 120) ||
      info.width * info.height > MAX_PIXELS
    )
      throw new Error('Invalid identity image')
    try {
      const output = await images
        .input(stream(buffer))
        .transform({ width: 2400, height: 2400, fit: 'scale-down' })
        .output({ format: 'image/png', anim: false })
      return Buffer.from(await output.response().arrayBuffer())
    } catch (error) {
      console.error('Cloudflare Images transform failed:', error?.message || error)
      throw unavailable()
    }
  }
}
