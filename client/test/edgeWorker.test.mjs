import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import worker from '../worker/index.js'

function bindings({ apiFailure = false } = {}) {
  const calls = { api: [], assets: [] }
  return {
    calls,
    env: {
      API: {
        fetch: async (request) => {
          calls.api.push(request)
          if (apiFailure) throw new Error('Service binding target is not deployed')
          return Response.json({ from: 'api' })
        },
      },
      ASSETS: {
        fetch: async (request) => {
          calls.assets.push(request)
          return new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
        },
      },
    },
  }
}

test('API and upload requests are forwarded unchanged to the API service binding', async () => {
  const { env, calls } = bindings()
  const login = new Request('https://rentease.test/api/auth/login', {
    method: 'POST',
    headers: { authorization: 'Bearer token-1', 'content-type': 'application/json' },
    body: '{"email":"a@b.c"}',
  })
  const response = await worker.fetch(login, env)
  assert.deepEqual(await response.json(), { from: 'api' })
  const photo = new Request('https://rentease.test/uploads/products/0f8fad5b-d9cb-469f-a165-70867728950e.png')
  await worker.fetch(photo, env)
  assert.deepEqual(calls.api, [login, photo], 'the original request objects are forwarded')
  assert.equal(calls.assets.length, 0)
})

test('anything else is served by the static assets binding', async () => {
  const { env, calls } = bindings()
  for (const path of ['/', '/rentals/123', '/apiary', '/assets/index-abc.js'])
    await worker.fetch(new Request(`https://rentease.test${path}`), env)
  assert.equal(calls.assets.length, 4)
  assert.equal(calls.api.length, 0)
})

test('an unreachable API returns a JSON 502 the client can display', async () => {
  const { env } = bindings({ apiFailure: true })
  const response = await worker.fetch(new Request('https://rentease.test/api/products'), env)
  assert.equal(response.status, 502)
  assert.match((await response.json()).message, /temporarily unavailable/)
})

test('wrangler config serves the SPA and only runs the Worker for forwarded paths', async () => {
  const config = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
  const json = JSON.parse(
    config
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n'),
  )
  assert.equal(json.assets.directory, './dist')
  assert.equal(json.assets.not_found_handling, 'single-page-application')
  assert.deepEqual(json.assets.run_worker_first, ['/api/*', '/uploads/*'])
  assert.equal(json.main, 'worker/index.js')
  for (const name of ['staging', 'production'])
    assert.equal(json.env[name].services[0].binding, 'API', name)
})
