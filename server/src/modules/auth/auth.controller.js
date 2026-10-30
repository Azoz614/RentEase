import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { randomInt } from 'node:crypto'
import { User } from '../users/user.model.mjs'
import { PendingRegistration } from './pending-registration.model.mjs'
import { sendRegistrationOtp } from '../../config/mailer.js'
import { createSession } from '../../middleware/auth.mjs'
import { hashOtp } from '../otp/registration-otp.service.mjs'
import {
  authError, authHandler, authHash, authRate, challengeTimes, emailValue,
  matchesHash, newProof, OTP_TTL, registrationCookie, registrationCookieOptions, validEmail, validatePassword,
} from './auth-security.service.mjs'

export function createAuthHandlers({ sendEmail = sendRegistrationOtp } = {}) {
  return {
    sendRegistrationCode: authHandler(async (req, res) => {
      const email = emailValue(req.body.email)
      const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
      const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : ''
      const accountType = req.body.accountType === 'rental_shop' ? 'rental_shop' : 'user'
      const shopName = typeof req.body.shopName === 'string' ? req.body.shopName.trim() : ''
      if (username.length < 2 || username.length > 50)
        throw authError(400, 'User name must be between 2 and 50 characters.')
      if (!validEmail(email)) throw authError(400, 'Enter a valid email address.')
      if (phone.length < 7 || phone.length > 24 || !/^[+\d().\s-]+$/.test(phone))
        throw authError(400, 'Enter a valid contact phone number.')
      if (accountType === 'rental_shop' && (!shopName || shopName.length > 100))
        throw authError(400, 'Enter your rental shop name (up to 100 characters).')
      await authRate(req, 'registration-send', email, true)
      if (await User.exists({ $or: [{ email }, { username }] }))
        throw authError(409, 'An account already uses that email or username. Please sign in.')
      const otp = String(randomInt(0, 1_000_000)).padStart(6, '0'), now = new Date()
      const otpHash = hashOtp(email, otp)
      await PendingRegistration.findOneAndUpdate({ email }, {
        $set: {
          username, email, phone, accountType, shopName, otpHash,
          otpExpiresAt: new Date(now.getTime() + OTP_TTL), otpAttempts: 0,
          lastOtpSentAt: now, verifiedAt: null,
          expiresAt: new Date(now.getTime() + 30 * 60_000),
        },
        $unset: { verificationTokenHash: 1 },
      }, { upsert: true, returnDocument: 'after', runValidators: true })
      try {
        await sendEmail(email, otp)
      } catch {
        await PendingRegistration.deleteOne({ email, otpHash })
        throw authError(503, 'We could not send your verification email. Please try again shortly.')
      }
      res.json({ message: 'Verification code sent to your email.', ...challengeTimes(now) })
    }),

    verifyRegistrationCode: authHandler(async (req, res) => {
      const email = emailValue(req.body.email), otp = req.body.otp
      if (!validEmail(email) || typeof otp !== 'string' || !/^\d{6}$/.test(otp))
        throw authError(400, 'Enter the six-digit code from your email.')
      await authRate(req, 'registration-verify', email)
      const pending = await PendingRegistration.findOneAndUpdate({
        email, verifiedAt: null, expiresAt: { $gt: new Date() },
        otpExpiresAt: { $gt: new Date() }, otpAttempts: { $lt: 5 },
      }, { $inc: { otpAttempts: 1 } }, { returnDocument: 'after' })
      if (!pending) throw authError(400, 'This code expired, was already used, or has too many attempts. Request a new code.')
      if (!matchesHash(pending.otpHash, hashOtp(email, otp)))
        throw authError(400, 'That code is incorrect. Please try again.')
      const registrationToken = newProof()
      const verified = await PendingRegistration.updateOne({
        _id: pending._id, otpHash: pending.otpHash, verifiedAt: null,
        expiresAt: { $gt: new Date() }, otpExpiresAt: { $gt: new Date() },
      }, { $set: {
        verifiedAt: new Date(), otpHash: 'verified',
        verificationTokenHash: authHash('registration', registrationToken),
      } })
      if (!verified.modifiedCount) throw authError(400, 'This code has already been used. Request a new code.')
      // Keep the existing email/password completion contract usable by older
      // same-origin clients, without trusting a public verifiedAt flag.
      res.cookie('rentease_registration', registrationToken, {
        ...registrationCookieOptions(req), maxAge: pending.expiresAt.getTime() - Date.now(),
      })
      res.json({ message: 'Email verified.', registrationToken, expiresAt: pending.expiresAt })
    }),

    completeRegistration: authHandler(async (req, res) => {
      const email = emailValue(req.body.email), { password, confirmPassword } = req.body
      const registrationToken = req.body.registrationToken || registrationCookie(req)
      if (!validEmail(email)) throw authError(400, 'Enter a valid email address.')
      validatePassword(password, confirmPassword)
      await authRate(req, 'registration-complete', email)
      if (typeof registrationToken !== 'string' || registrationToken.length !== 43)
        throw authError(400, 'Verify your email before creating the account.')
      const proof = {
        email, verifiedAt: { $ne: null }, expiresAt: { $gt: new Date() },
        verificationTokenHash: authHash('registration', registrationToken),
      }
      if (!await PendingRegistration.exists(proof))
        throw authError(400, 'Registration verification expired. Please request a new code.')
      const passwordHash = await bcrypt.hash(password, 12)
      let user
      // Consume verification and create the account together, avoiding partial registration.
      await mongoose.connection.transaction(async (session) => {
        const claimed = await PendingRegistration.findOneAndDelete({ ...proof, expiresAt: { $gt: new Date() } }, { session })
        if (!claimed) throw authError(400, 'Registration verification expired or was already used.')
        ;[user] = await User.create([{
          username: claimed.username, email: claimed.email, phone: claimed.phone,
          password: passwordHash, role: claimed.accountType === 'rental_shop' ? 'rental_shop' : 'user',
          shopName: claimed.shopName || '',
          shopStatus: claimed.accountType === 'rental_shop' ? 'pending' : 'not_applicable',
        }], { session })
      })
      res.clearCookie('rentease_registration', registrationCookieOptions(req))
      res.status(201).json({
        message: user.role === 'rental_shop'
          ? 'Account created successfully. Your rental shop is awaiting admin approval. Please sign in after approval.'
          : 'Account created successfully. Please sign in.',
        userId: user._id,
      })
    }),
  }
}

export const { sendRegistrationCode, verifyRegistrationCode, completeRegistration } = createAuthHandlers()

export const login = authHandler(async (req, res) => {
  const email = emailValue(req.body.email), { password } = req.body
  if (!email || typeof password !== 'string' || !password)
    throw authError(400, 'Email and password are required.')
  if (password.length > 128 || email.length > 254)
    throw authError(401, 'Email or password is incorrect.')
  // Key the account limit by email and IP, so strangers cannot lock someone out of their own
  // account by failing logins against it. The per-IP limit inside authRate still applies.
  await authRate(req, 'login', `${email}|${req.ip || 'unknown'}`)
  const user = await User.findOne({ email }).select('+sessionVersion')
  if (!user || !(await bcrypt.compare(password, user.password)))
    throw authError(401, 'Email or password is incorrect.')
  res.json(await sessionResult(user))
})

export async function sessionResult(user) {
  if (process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL.trim().toLowerCase() && user.role !== 'admin') {
    user.role = 'admin'
    user.shopStatus = 'not_applicable'
    await user.save()
  }
  if (!user.active) throw authError(403, 'This account has been suspended. Contact support.')
  if (user.role === 'rental_shop' && user.shopStatus !== 'approved')
    throw authError(403, `Your rental shop is ${user.shopStatus}. You can sign in after an administrator approves it.`)
  return {
    message: 'Signed in successfully.', token: createSession(user._id, user.sessionVersion || 0),
    user: {
      id: user._id, username: user.username, email: user.email, phone: user.phone,
      role: user.role, shopName: user.shopName, shopStatus: user.shopStatus,
    },
  }
}
