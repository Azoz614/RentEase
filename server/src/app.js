import { createApiRouter } from './routes/api.routes.js'
import { errorHandler } from './middleware/error-handler.js'
import express from 'express'

import mongoose from 'mongoose'
import { uploadsDirectory } from './config/paths.js'

const app = express()
// Sign-in routes are public and never carry photos, so anonymous clients cannot make the
// server parse multi-megabyte bodies. Everything else allows photo and document uploads.
app.use(['/api/auth', '/api/v1/auth'], express.json({ limit: '100kb' }))
app.use(express.json({ limit: '22mb' }))
// Node serves uploads from disk. On Cloudflare Workers (no file: module URLs) the
// Worker entry serves them from R2 before requests reach Express.
if (import.meta.url?.startsWith('file:'))
  app.use(
    '/uploads',
    express.static(uploadsDirectory(), {
      setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
    }),
  )

// /api/health is reachable through the web front end, which only forwards /api/* and /uploads/*.
app.get(['/health', '/api/health'], (_req, res) => {
  const ready = mongoose.connection.readyState === 1
  res
    .status(ready ? 200 : 503)
    .json({ status: ready ? 'ok' : 'unavailable', database: ready ? 'connected' : 'disconnected' })
})

// Mount the specific prefix first so legacy auth middleware cannot intercept v1 login/public routes.
app.use('/api/v1', createApiRouter())
app.use('/api', createApiRouter())

app.get('/', (req, res) => {
  res.send('RentEase API is running')
})

app.use(errorHandler)

export default app
