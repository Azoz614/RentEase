import 'dotenv/config'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { User } from '../src/model/user.mjs'

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    process.stdout.write(prompt)
    if (!input.isTTY || !input.setRawMode) {
      reject(new Error('Run this command in an interactive terminal so the password can be entered without echo.'))
      return
    }
    input.setRawMode(true)
    input.resume()
    let value = ''
    const finish = (error) => {
      input.setRawMode(false)
      input.pause()
      input.removeListener('data', onData)
      process.stdout.write('\n')
      error ? reject(error) : resolve(value)
    }
    const onData = (chunk) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') return finish(new Error('Cancelled.'))
        if (character === '\r' || character === '\n') return finish()
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1)
        else if (character >= ' ') value += character
      }
    }
    input.on('data', onData)
  })
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  if (!email) throw new Error('Set ADMIN_EMAIL in server/.env before running this command.')
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing from server/.env.')
  const password = await readHidden(`Password for ${email}: `)
  if (password.length < 10) throw new Error('Password must contain at least 10 characters.')

  await mongoose.connect(process.env.MONGO_URI)
  const passwordHash = await bcrypt.hash(password, 12)
  const existing = await User.findOne({ email })
  if (existing) {
    existing.password = passwordHash
    existing.role = 'admin'
    existing.active = true
    existing.shopStatus = 'not_applicable'
    await existing.save()
    process.stdout.write(`Admin account ${email} updated.\n`)
  } else {
    await User.create({ username: 'admin', email, phone: 'Not provided', password: passwordHash, role: 'admin', active: true })
    process.stdout.write(`Admin account ${email} created.\n`)
  }
}

main()
  .catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect()
  })
