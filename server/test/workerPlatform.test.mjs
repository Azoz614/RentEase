import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { diskObjectStore, r2ObjectStore } from '../src/platform/object-store.mjs'
import {
  configureProductPhotoStore,
  removeProductPhotos,
  saveProductPhotos,
} from '../src/modules/products/product-images.service.mjs'
import {
  configureIdentityDocuments,
  prepareIdentityPhoto,
  readIdentityPhoto,
  storeIdentityPhoto,
} from '../src/modules/identity/identity-documents.service.mjs'
import { cloudflareIdentityPhotoProcessor } from '../src/worker/cloudflare-images.mjs'
import { handleRequest, serveProductPhoto, withClientAddress } from '../src/worker/router.mjs'
import {
  DISPATCH_CRON,
  RETENTION_CRON,
  mongoOptions,
  populateProcessEnv,
  retentionMode,
} from '../src/worker/runtime.mjs'

const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e'
const png = Buffer.from('89504e470d0a1a0a', 'hex')
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')])
const dataUri = (mime, bytes = mime === 'image/webp' ? webp : png) =>
  `data:${mime};base64,${bytes.toString('base64')}`

// Minimal in-memory stand-in for an R2 bucket binding.
function fakeBucket() {
  const objects = new Map()
  return {
    objects,
    async put(key, value, options = {}) {
      objects.set(key, { bytes: Buffer.from(value), httpMetadata: options.httpMetadata || {} })
    },
    async get(key, options = {}) {
      const stored = objects.get(key)
      if (!stored) return null
      const object = {
        httpEtag: '"etag-1"',
        writeHttpMetadata(headers) {
          if (stored.httpMetadata.contentType)
            headers.set('content-type', stored.httpMetadata.contentType)
        },
      }
      // R2 omits the body when an onlyIf precondition (e.g. If-None-Match) fails.
      if (options.onlyIf?.get?.('if-none-match') === '"etag-1"') return object
      return Object.assign(object, {
        body: new Blob([stored.bytes]).stream(),
        arrayBuffer: async () => stored.bytes.buffer.slice(
          stored.bytes.byteOffset,
          stored.bytes.byteOffset + stored.bytes.byteLength,
        ),
      })
    },
    async delete(key) {
      objects.delete(key)
    },
  }
}

function fakeImages({ info = { format: 'image/jpeg', width: 1200, height: 800 }, fail } = {}) {
  const calls = []
  return {
    calls,
    async info(stream) {
      assert.ok(stream instanceof ReadableStream)
      if (info instanceof Error) throw info
      return info
    },
    input(stream) {
      assert.ok(stream instanceof ReadableStream)
      const chain = {
        transform(options) {
          calls.push(['transform', options])
          return chain
        },
        async output(options) {
          calls.push(['output', options])
          if (fail) throw new Error('9422: transformation quota exhausted')
          return { response: () => new Response(png, { headers: { 'content-type': 'image/png' } }) }
        },
      }
      return chain
    },
  }
}

let directory
before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'rentease-store-'))
  process.env.IDENTITY_ENCRYPTION_KEY = randomBytes(32).toString('base64')
})
after(async () => {
  await rm(directory, { recursive: true, force: true })
})

test('R2 object store prefixes keys, records content type and treats missing objects as null', async () => {
  const bucket = fakeBucket()
  const store = r2ObjectStore(bucket, 'products/')
  await store.put(`${uuid}.png`, png, 'image/png')
  assert.deepEqual([...bucket.objects.keys()], [`products/${uuid}.png`])
  assert.equal(bucket.objects.get(`products/${uuid}.png`).httpMetadata.contentType, 'image/png')
  assert.deepEqual(await store.get(`${uuid}.png`), png)
  assert.equal(await store.get('missing.png'), null)
  // Paths are reduced to their file name so keys cannot escape the prefix.
  await store.delete(`/uploads/products/../../${uuid}.png`)
  assert.equal(bucket.objects.size, 0)
  assert.throws(() => r2ObjectStore(undefined, 'products/'), /binding/)
})

test('disk object store never overwrites, returns null for missing files and ignores missing deletes', async () => {
  const store = diskObjectStore(() => directory, { fileMode: 0o600 })
  await store.put('photo.png', png)
  await assert.rejects(store.put('photo.png', png), { code: 'EEXIST' })
  assert.deepEqual(await readFile(path.join(directory, 'photo.png')), png)
  assert.deepEqual(await store.get('photo.png'), png)
  assert.equal(await store.get('absent.png'), null)
  await store.delete('photo.png')
  await store.delete('photo.png')
  assert.equal(await store.get('photo.png'), null)
})

test('product photos use the configured store and roll back new uploads when a later photo is invalid', async () => {
  const bucket = fakeBucket()
  configureProductPhotoStore(r2ObjectStore(bucket, 'products/'))
  const existing = `/uploads/products/${uuid}.jpg`
  const { photos, newPaths } = await saveProductPhotos(
    [existing, dataUri('image/png'), dataUri('image/webp')],
    [existing],
  )
  assert.equal(photos[0], existing)
  assert.equal(newPaths.length, 2)
  for (const photo of newPaths) assert.match(photo, /^\/uploads\/products\/[a-f0-9-]{36}\.(png|webp)$/)
  assert.deepEqual(
    [...bucket.objects.values()].map((object) => object.httpMetadata.contentType).sort(),
    ['image/png', 'image/webp'],
  )

  await assert.rejects(
    saveProductPhotos([dataUri('image/png'), 'data:image/gif;base64,R0lGOD=='], []),
    { status: 400, message: /JPEG, PNG, or WebP/ },
  )
  assert.equal(bucket.objects.size, 2, 'the first photo of the failed batch was removed again')

  await removeProductPhotos([...newPaths, '/etc/passwd', 'https://example.com/a.png'])
  assert.equal(bucket.objects.size, 0)
})

test('identity documents are stored encrypted in the configured private store', async () => {
  const bucket = fakeBucket()
  configureIdentityDocuments({ store: r2ObjectStore(bucket, 'identity-v2/') })
  const plaintext = Buffer.from('private identity card pixels')
  const document = await storeIdentityPhoto(plaintext, 'user-1', 'front')
  const [[key, stored]] = [...bucket.objects]
  assert.equal(key, `identity-v2/${document.filename}`)
  assert.ok(!stored.bytes.includes(plaintext), 'stored bytes are encrypted')
  assert.deepEqual(await readIdentityPhoto(document, 'user-1', 'front'), plaintext)
  await assert.rejects(readIdentityPhoto(document, 'user-2', 'front'))
  bucket.objects.clear()
  await assert.rejects(readIdentityPhoto(document, 'user-1', 'front'), {
    status: 404,
    code: 'DOCUMENT_NOT_FOUND',
  })
})

test('Cloudflare Images processor enforces the identity photo rules and re-encodes as PNG', async () => {
  const images = fakeImages()
  const result = await cloudflareIdentityPhotoProcessor(images)(png, 'image/jpeg')
  assert.deepEqual(result, png)
  assert.deepEqual(images.calls, [
    ['transform', { width: 2400, height: 2400, fit: 'scale-down' }],
    ['output', { format: 'image/png', anim: false }],
  ])

  const rejects = async (info) =>
    assert.rejects(cloudflareIdentityPhotoProcessor(fakeImages({ info }))(png, 'image/jpeg'), {
      message: 'Invalid identity image',
    })
  await rejects({ format: 'image/png', width: 1200, height: 800 }) // declared type mismatch
  await rejects({ format: 'image/jpeg', width: 150, height: 800 }) // too narrow
  await rejects({ format: 'image/jpeg', width: 1200, height: 100 }) // too short
  await rejects({ format: 'image/jpeg', width: 6000, height: 4000 }) // over 20 MP
  await rejects({ format: 'image/svg+xml' }) // no dimensions
  // A bare format name is accepted as well as a MIME type.
  await cloudflareIdentityPhotoProcessor(fakeImages({ info: { format: 'jpeg', width: 400, height: 300 } }))(
    png,
    'image/jpeg',
  )
})

test('identity photo preparation separates bad photos from image service outages', async () => {
  const photo = dataUri('image/jpeg')
  configureIdentityDocuments({ processPhoto: cloudflareIdentityPhotoProcessor(fakeImages({ fail: true })) })
  await assert.rejects(prepareIdentityPhoto(photo), { status: 503, code: 'IMAGE_PROCESSING_UNAVAILABLE' })
  configureIdentityDocuments({ processPhoto: cloudflareIdentityPhotoProcessor(undefined) })
  await assert.rejects(prepareIdentityPhoto(photo), { status: 503 })
  configureIdentityDocuments({
    processPhoto: cloudflareIdentityPhotoProcessor(fakeImages({ info: new Error('decode failed') })),
  })
  await assert.rejects(prepareIdentityPhoto(photo), { status: 400, code: 'INVALID_PHOTO' })
  configureIdentityDocuments({ processPhoto: cloudflareIdentityPhotoProcessor(fakeImages()) })
  assert.deepEqual(await prepareIdentityPhoto(photo), png)
})

test('product photos are served from R2 with immutable caching and conditional responses', async () => {
  const bucket = fakeBucket()
  await bucket.put(`products/${uuid}.webp`, png, { httpMetadata: { contentType: 'image/webp' } })
  const url = `https://rentease.test/uploads/products/${uuid}.webp`

  const response = await serveProductPhoto(new Request(url), bucket)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/webp')
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal(response.headers.get('etag'), '"etag-1"')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)

  const head = await serveProductPhoto(new Request(url, { method: 'HEAD' }), bucket)
  assert.equal(head.status, 200)
  assert.equal(head.body, null)

  const cached = await serveProductPhoto(new Request(url, { headers: { 'if-none-match': '"etag-1"' } }), bucket)
  assert.equal(cached.status, 304)

  for (const request of [
    new Request(`https://rentease.test/uploads/products/${uuid}.gif`),
    new Request('https://rentease.test/uploads/products/../../private/key.bin'),
    new Request(`https://rentease.test/uploads/products/0f8fad5b-d9cb-469f-a165-70867728950f.png`),
    new Request(url, { method: 'DELETE' }),
  ]) {
    const missing = await serveProductPhoto(request, bucket)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { message: 'File not found.' })
  }
})

test('API requests are forwarded to the Durable Object with the Cloudflare client address', async () => {
  const forwarded = []
  const apiServer = () => ({
    fetch: async (request) => {
      forwarded.push(request)
      return new Response('ok')
    },
  })
  const env = { MEDIA_BUCKET: fakeBucket() }
  await handleRequest(
    new Request('https://rentease.test/api/auth/login', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1', authorization: 'Bearer t' },
      body: '{"email":"a@b.c"}',
    }),
    env,
    apiServer,
  )
  assert.equal(forwarded[0].headers.get('x-forwarded-for'), '203.0.113.7')
  assert.equal(forwarded[0].headers.get('authorization'), 'Bearer t')
  assert.equal(await forwarded[0].text(), '{"email":"a@b.c"}')

  // Without a Cloudflare address, a client-supplied X-Forwarded-For is dropped.
  const spoofed = withClientAddress(
    new Request('https://rentease.test/api/x', { headers: { 'x-forwarded-for': '10.0.0.1' } }),
  )
  assert.equal(spoofed.headers.get('x-forwarded-for'), null)

  const upload = await handleRequest(
    new Request(`https://rentease.test/uploads/products/${uuid}.png`),
    env,
    apiServer,
  )
  assert.equal(upload.status, 404)
  assert.equal(forwarded.length, 1, 'uploads never wake the API Durable Object')
})

test('Worker runtime settings copy string bindings and bound the MongoDB pool', () => {
  const previous = process.env.RENTEASE_TEST_VALUE
  populateProcessEnv({ RENTEASE_TEST_VALUE: 'from-binding', MEDIA_BUCKET: {}, API_SERVER: {} })
  assert.equal(process.env.RENTEASE_TEST_VALUE, 'from-binding')
  assert.equal(process.env.MEDIA_BUCKET, undefined)
  if (previous === undefined) delete process.env.RENTEASE_TEST_VALUE
  else process.env.RENTEASE_TEST_VALUE = previous

  assert.equal(mongoOptions({}).maxPoolSize, 2)
  assert.equal(mongoOptions({ MONGO_MAX_POOL_SIZE: '12' }).maxPoolSize, 12)
  assert.equal(mongoOptions({ MONGO_MAX_POOL_SIZE: 'lots' }).maxPoolSize, 2)
  assert.equal(mongoOptions({}).serverMonitoringMode, 'poll')
  assert.equal(retentionMode({}), 'dry-run')
  assert.equal(retentionMode({ IDENTITY_RETENTION_PURGE: 'apply' }), 'apply')
})

// Strips // and /* */ comments outside strings plus trailing commas.
function parseJsonc(text) {
  let output = ''
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      const end = text.indexOf('"', index + 1)
      let close = end
      while (text[close - 1] === '\\') close = text.indexOf('"', close + 1)
      output += text.slice(index, close + 1)
      index = close
    } else if (character === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index)
      if (end === -1) break
      index = end - 1
    } else if (character === '/' && text[index + 1] === '*') {
      index = text.indexOf('*/', index) + 1
    } else output += character
  }
  return JSON.parse(output.replace(/,(\s*[}\]])/g, '$1'))
}

test('Wrangler configs give every environment its bindings and point the web Worker at the matching API', async () => {
  const api = parseJsonc(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))
  const web = parseJsonc(await readFile(new URL('../../client/wrangler.jsonc', import.meta.url), 'utf8'))
  assert.deepEqual(api.triggers.crons, [DISPATCH_CRON, RETENTION_CRON])
  assert.equal(api.alias.sharp, './src/platform/sharp-unavailable.mjs')
  assert.deepEqual(api.migrations, [{ tag: 'v1', new_sqlite_classes: ['ApiServer'] }])

  const environments = [
    ['top level', api, web],
    ...['staging', 'production'].map((name) => [name, api.env[name], web.env[name]]),
  ]
  const secretNames = ['MONGO_URI', 'SESSION_SECRET', 'OTP_SECRET', 'IDENTITY_ENCRYPTION_KEY', 'SMTP_PASS']
  for (const [name, apiEnv, webEnv] of environments) {
    assert.deepEqual(apiEnv.durable_objects.bindings, [{ name: 'API_SERVER', class_name: 'ApiServer' }], name)
    assert.deepEqual(apiEnv.r2_buckets.map((bucket) => bucket.binding), ['MEDIA_BUCKET', 'IDENTITY_BUCKET'], name)
    assert.notEqual(apiEnv.r2_buckets[0].bucket_name, apiEnv.r2_buckets[1].bucket_name, `${name}: identity bucket is separate`)
    assert.equal(apiEnv.images?.binding, 'IMAGES', name)
    for (const secret of secretNames) assert.ok(!(secret in apiEnv.vars), `${name}: ${secret} must be a secret`)
    assert.deepEqual(webEnv.services, [{ binding: 'API', service: apiEnv.name }], name)
  }
  assert.equal(new Set(environments.map(([, apiEnv]) => apiEnv.name)).size, 3)
  assert.equal(new Set(environments.flatMap(([, apiEnv]) => apiEnv.r2_buckets.map((b) => b.bucket_name))).size, 6)
})

test('SMTP sockets are opened by hostname and handed to nodemailer ready to use', async () => {
  const { createServer } = await import('node:net')
  const { smtpSocketByHostname } = await import('../src/worker/smtp-socket.mjs')
  const server = createServer((socket) => {
    socket.on('error', () => {})
    socket.write('220 test ESMTP\r\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  const result = await new Promise((resolve) =>
    smtpSocketByHostname({ host: 'localhost', port, secure: false }, (error, options) => resolve({ error, options })),
  )
  assert.equal(result.error, null)
  assert.ok(result.options.connection, 'a connected socket is returned')
  assert.equal(result.options.secured, undefined, 'port 587 sockets are upgraded by nodemailer itself')
  result.options.connection.on('error', () => {}).destroy()
  await new Promise((resolve) => server.close(resolve))

  const failure = await new Promise((resolve) =>
    smtpSocketByHostname({ host: '127.0.0.1', port, secure: false }, (error) => resolve(error)),
  )
  assert.ok(failure instanceof Error, 'connection errors reach nodemailer')
})
