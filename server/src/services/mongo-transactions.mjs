import mongoose from 'mongoose'
import { createHttpError as failure } from '../utils/http-error.mjs'

export async function requireTransactions() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 })
  if (!hello.setName && hello.msg !== 'isdbgrid')
    throw failure(
      503,
      'TRANSACTIONS_REQUIRED',
      'Secure rental and identity workflows require a MongoDB replica set. Ask your system administrator to complete database setup.',
    )
}

export async function transactionsAvailable() {
  const hello = await mongoose.connection.db.admin().command({ hello: 1 })
  return Boolean(hello.setName || hello.msg === 'isdbgrid')
}
