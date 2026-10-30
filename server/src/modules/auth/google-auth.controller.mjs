import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { User } from '../users/user.model.mjs'
import { VerificationRate } from '../otp/verification-rate.model.mjs'
import { sessionResult } from './auth.controller.js'
import { authError, authHandler, authHash, authRate, newProof, rate, validEmail, validatePassword } from './auth-security.service.mjs'

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
export async function verifyGoogleCredential(credential, audience, keySet = keys) {
  const { payload } = await jwtVerify(credential, keySet, {
    audience, issuer: ['https://accounts.google.com', 'accounts.google.com'], algorithms: ['RS256'],
    requiredClaims: ['sub', 'email', 'email_verified', 'nonce', 'iat', 'exp'], maxTokenAge: '10m', clockTolerance: 5,
  })
  if (payload.email_verified !== true || !validEmail(payload.email || '') ||
    typeof payload.sub !== 'string' || !payload.sub || typeof payload.nonce !== 'string')
    throw new Error('Invalid Google identity')
  return payload
}

export function createGoogleHandlers({ verifyCredential = verifyGoogleCredential } = {}) {
  return {
    googleConfig: authHandler(async (req, res) => {
      const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
      if (!clientId) return res.json({ enabled: false })
      // Runs on every sign-in page view, and many users can share one carrier IP,
      // so this only caps nonce spam. Sign-in itself keeps the strict authRate limits.
      await rate(`google-config:ip:${req.ip || 'unknown'}`, 300)
      const nonce = newProof()
      await VerificationRate.create({ _id: `google:${authHash('nonce', nonce)}`, count: 0, expiresAt: new Date(Date.now() + 5 * 60_000) })
      res.json({ enabled: true, clientId, nonce })
    }),
    googleLogin: authHandler(async (req, res) => {
      const clientId = process.env.GOOGLE_CLIENT_ID?.trim()
      if (!clientId) throw authError(503, 'Google sign-in is not configured yet.')
      await authRate(req, 'google-login', req.ip)
      const { credential } = req.body
      if (typeof credential !== 'string' || credential.length > 10_000)
        throw authError(400, 'Choose your Google account to continue.')
      let claims
      try { claims = await verifyCredential(credential, clientId) }
      catch (error) {
        if (['JWKSTimeout', 'JWKSInvalid'].includes(error.name) || error instanceof TypeError)
          throw authError(503, 'Google verification is temporarily unavailable. Please try again.')
        throw authError(401, 'Google sign-in expired or could not be verified. Please try again.')
      }
      const challenge = { _id: `google:${authHash('nonce', claims.nonce)}`, expiresAt: { $gt: new Date() } }
      if (!await VerificationRate.exists(challenge))
        throw authError(401, 'Google sign-in expired or was already used. Please try again.')
      const email = claims.email.trim().toLowerCase()
      let user = await User.findOne({ googleSubject: claims.sub }).select('+googleSubject +sessionVersion')
      if (!user) {
        user = await User.findOne({ email }).select('+googleSubject +sessionVersion')
        if (user) {
          if (user.googleSubject && user.googleSubject !== claims.sub)
            throw authError(409, 'This account is already linked to another Google identity.')
          if (typeof req.body.password !== 'string' || !req.body.password)
            throw authError(409, 'An account already uses this email. Confirm its RentEase password to securely link Google.', { code: 'GOOGLE_LINK_REQUIRED' })
          await authRate(req, 'google-link', email)
          if (req.body.password.length > 128 || !await bcrypt.compare(req.body.password, user.password))
            throw authError(401, 'Your RentEase password is incorrect.', { code: 'GOOGLE_LINK_REQUIRED' })
        } else {
          if (!email.endsWith('@gmail.com') && !claims.hd)
            throw authError(403, 'Please register and verify this email with RentEase first, then link Google when signing in.')
          const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : ''
          if (phone.length < 7 || phone.length > 24 || !/^[+\d().\s-]+$/.test(phone))
            throw authError(409, 'Add a contact phone number to finish creating your account.', { code: 'GOOGLE_PROFILE_REQUIRED' })
          // NIC/address changes already require password confirmation. New Google
          // customers need a password they know to use those existing safeguards.
          if (typeof req.body.password !== 'string' || !req.body.password)
            throw authError(409, 'Choose a RentEase password to protect identity and account changes.', { code: 'GOOGLE_PROFILE_REQUIRED' })
          validatePassword(req.body.password, req.body.confirmPassword)
          const baseName = String(claims.name || 'Customer').trim().slice(0, 40) || 'Customer'
          const username = await User.exists({ username: baseName }) ? `${baseName} ${newProof().slice(0, 8)}` : baseName
          user = new User({ email, phone, role: 'user', username,
            password: await bcrypt.hash(req.body.password, 12), googleSubject: claims.sub })
        }
      }
      // Check suspension and approvals before linking or consuming the nonce.
      if (!user.active) throw authError(403, 'This account has been suspended. Contact support.')
      if (user.role === 'rental_shop' && user.shopStatus !== 'approved')
        throw authError(403, 'Your rental shop is awaiting administrator approval.')
      await mongoose.connection.transaction(async (session) => {
        if (!await VerificationRate.findOneAndDelete({ ...challenge, expiresAt: { $gt: new Date() } }, { session }))
          throw authError(401, 'Google sign-in was already used. Please try again.')
        if (user.isNew) await user.save({ session })
        else {
          const linked = await User.updateOne({ _id: user._id, active: true, password: user.password, $or: [
            { googleSubject: { $exists: false } }, { googleSubject: claims.sub },
          ] }, { $set: { googleSubject: claims.sub } }, { session })
          if (!linked.matchedCount) throw authError(409, 'Your account changed. Please sign in again.')
        }
      })
      res.json(await sessionResult(user))
    }),
  }
}
