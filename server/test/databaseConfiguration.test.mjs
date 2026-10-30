import { afterEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import { connectDB } from '../src/config/db.js'
import { DeliveryTask } from '../src/modules/delivery/delivery-task.model.mjs'
import { PartnerPresence } from '../src/modules/delivery/partner-presence.model.mjs'
import { Notification } from '../src/modules/notifications/notification.model.mjs'

const originalUri = process.env.MONGO_URI
const originalDatabase = mongoose.connection.db
afterEach(() => {
  mock.restoreAll()
  mongoose.connection.db = originalDatabase
  if (originalUri === undefined) delete process.env.MONGO_URI
  else process.env.MONGO_URI = originalUri
})

function installDatabase(hello) {
  process.env.MONGO_URI = 'mongodb://example-user:private-test-password@localhost:27017/rentease'
  const connect = mock.method(mongoose, 'connect', async () => mongoose)
  // connectDB builds these indexes; without a real connection init() would wait forever.
  for (const model of [DeliveryTask, PartnerPresence, Notification])
    mock.method(model, 'init', async () => {})
  mongoose.connection.db = { admin: () => ({ command: async (command) => {
    assert.deepEqual(command, { hello: 1 })
    return hello
  } }) }
  const logs = []
  mock.method(console, 'log', (message) => logs.push(message))
  mock.method(console, 'warn', (message) => logs.push(message))
  return { connect, logs }
}

test('database startup rejects missing configuration before attempting a connection', async () => {
  const { connect } = installDatabase({})
  delete process.env.MONGO_URI
  await assert.rejects(connectDB(), /Set MONGO_URI/)
  assert.equal(connect.mock.callCount(), 0)
})

test('local replica-set startup uses the configured URI unchanged and reports transaction readiness without secrets', async () => {
  const { connect, logs } = installDatabase({ setName: 'rentease-rs' })
  await connectDB()
  assert.equal(connect.mock.calls[0].arguments[0], process.env.MONGO_URI)
  assert.ok(logs.some((message) => message.includes('transactions are available')))
  assert.ok(logs.every((message) => !message.includes('private-test-password') && !message.includes('example-user')))
})

test('standalone startup gives an actionable warning without disabling the transaction guard', async () => {
  const { logs } = installDatabase({ isWritablePrimary: true })
  await connectDB()
  assert.ok(logs.some((message) => message.includes('MongoDB is standalone') && message.includes('docs/CUSTOMER_IDENTITY.md')))
  assert.ok(!logs.some((message) => message.includes('transactions are available')))
})

test('sharded cluster startup also reports transaction availability', async () => {
  const { logs } = installDatabase({ msg: 'isdbgrid' })
  await connectDB()
  assert.ok(logs.some((message) => message.includes('transactions are available')))
})
