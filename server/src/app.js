import { createApiRouter } from './routes/api.routes.js'
import { errorHandler } from './middleware/error-handler.js'
import express from 'express'

import { fileURLToPath } from 'node:url'
import mongoose from 'mongoose'

const app = express()
app.use(express.json({ limit: '22mb' }))
app.use('/uploads', express.static(fileURLToPath(new URL('../uploads', import.meta.url))))

// Mount the specific prefix first so legacy auth middleware cannot intercept v1 login/public routes.
app.use('/api/v1', createApiRouter())
app.use('/api', createApiRouter())

app.get('/', (req, res) => {
  res.send('RentEase API is running')
})

app.get('/health', (_req, res) => {
  const ready = mongoose.connection.readyState === 1
  res
    .status(ready ? 200 : 503)
    .json({ status: ready ? 'ok' : 'unavailable', database: ready ? 'connected' : 'disconnected' })
})

app.use(errorHandler)

export default app
