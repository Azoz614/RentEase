import { createHmac, timingSafeEqual } from 'node:crypto'
import { User } from '../modules/users/user.model.mjs'

const secret = () => process.env.SESSION_SECRET || process.env.OTP_SECRET

export function createSession(userId, sessionVersion = 0) {
  if (!secret()) throw new Error('Set SESSION_SECRET or OTP_SECRET to sign sessions.')
  const payload = Buffer.from(
    JSON.stringify({ sub: String(userId), ver: sessionVersion, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }),
  ).toString('base64url')
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url')
  return `${payload}.${signature}`
}

export async function requireUser(req, res, next) {
  try {
    const [payload, signature] = (req.get('authorization') || '')
      .replace(/^Bearer\s+/i, '')
      .split('.')
    if (!payload || !signature || !secret())
      return res.status(401).json({ message: 'Please sign in to continue.' })
    const expected = createHmac('sha256', secret()).update(payload).digest()
    const actual = Buffer.from(signature, 'base64url')
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return res.status(401).json({ message: 'Your session is invalid. Please sign in again.' })
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!session.sub || !Number.isFinite(session.exp) || session.exp < Date.now())
      return res.status(401).json({ message: 'Your session expired. Please sign in again.' })
    const user = await User.findById(session.sub).select('-password +sessionVersion')
    if (!user || !user.active)
      return res.status(401).json({ message: 'This account is unavailable.' })
    if ((session.ver || 0) !== (user.sessionVersion || 0))
      return res.status(401).json({ message: 'Your password changed. Please sign in again.' })
    if (user.role === 'rental_shop' && user.shopStatus !== 'approved')
      return res
        .status(403)
        .json({ message: 'Your rental shop account is awaiting admin approval.' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ message: 'Please sign in again.' })
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ message: 'Admin access is required.' })
  next()
}
