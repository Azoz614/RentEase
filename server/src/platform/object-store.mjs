import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

// Uploaded files are kept behind a tiny put/get/delete store so the same services
// run on a Node server (local disk) and on Cloudflare Workers (R2 buckets).

// `directory` is resolved on every call so configuration changes take effect
// without restarting (the identity tests point it at a temporary directory).
export function diskObjectStore(directory, { directoryMode, fileMode } = {}) {
  const file = (name) => path.join(directory(), path.basename(name))
  return {
    async put(name, bytes) {
      await mkdir(directory(), { recursive: true, ...(directoryMode && { mode: directoryMode }) })
      await writeFile(file(name), bytes, { flag: 'wx', ...(fileMode && { mode: fileMode }) })
    },
    async get(name) {
      try {
        return await readFile(file(name))
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    },
    async delete(name) {
      await unlink(file(name)).catch((error) => {
        if (error.code !== 'ENOENT') throw error
      })
    },
  }
}

export function r2ObjectStore(bucket, prefix = '') {
  if (!bucket) throw new Error(`R2 bucket binding for "${prefix}" objects is not configured.`)
  const key = (name) => prefix + path.basename(name)
  return {
    async put(name, bytes, contentType) {
      await bucket.put(key(name), bytes, contentType ? { httpMetadata: { contentType } } : {})
    },
    async get(name) {
      const object = await bucket.get(key(name))
      return object ? Buffer.from(await object.arrayBuffer()) : null
    },
    // R2 deletes are idempotent: removing a missing key is not an error.
    async delete(name) {
      await bucket.delete(key(name))
    },
  }
}
