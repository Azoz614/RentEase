import bcrypt from 'bcryptjs'
import { randomInt, timingSafeEqual } from 'node:crypto'
import { User } from '../users/user.model.mjs'
import { PendingRegistration } from './pending-registration.model.mjs'
import { sendRegistrationOtp } from '../../config/mailer.js'
import { createSession } from '../../middleware/auth.mjs'

import { hashOtp } from '../otp/registration-otp.service.mjs'

export const sendRegistrationCode = async (req, res) => {
  try {
    const { username, email, phone } = req.body
    const accountType = req.body.accountType === 'rental_shop' ? 'rental_shop' : 'user'
    const shopName = typeof req.body.shopName === 'string' ? req.body.shopName.trim() : ''

    if (
      typeof username !== 'string' ||
      typeof email !== 'string' ||
      typeof phone !== 'string' ||
      !username.trim() ||
      !email.trim() ||
      !phone.trim()
    ) {
      return res.status(400).json({ message: 'Username, email, and phone are required.' })
    }
    if (accountType === 'rental_shop' && !shopName)
      return res.status(400).json({ message: 'Enter your rental shop name.' })

    const normalizedEmail = email.trim().toLowerCase()
    if (await User.exists({ email: normalizedEmail })) {
      return res.status(409).json({ message: 'An account already uses this email.' })
    }

    const previousPending = await PendingRegistration.findOne({ email: normalizedEmail })
    if (previousPending?.verifiedAt) {
      return res
        .status(409)
        .json({ message: 'This email is already verified. Continue creating your account.' })
    }
    if (
      previousPending?.lastOtpSentAt &&
      Date.now() - previousPending.lastOtpSentAt.getTime() < 60_000
    ) {
      return res.status(429).json({ message: 'Wait one minute before requesting another code.' })
    }

    const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const now = new Date()

    await PendingRegistration.findOneAndUpdate(
      { email: normalizedEmail },
      {
        username: username.trim(),
        email: normalizedEmail,
        phone: phone.trim(),
        accountType,
        shopName,
        otpHash: hashOtp(normalizedEmail, otp),
        otpExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        otpAttempts: 0,
        lastOtpSentAt: now,
        verifiedAt: null,
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      },
      { upsert: true, new: true, runValidators: true },
    )

    try {
      await sendRegistrationOtp(normalizedEmail, otp)
    } catch (mailError) {
      await PendingRegistration.deleteOne({ email: normalizedEmail })
      throw mailError
    }
    return res.status(200).json({ message: 'Verification code sent to your email.' })
  } catch (error) {
    console.error('Send registration OTP error:', error)
    const message =
      process.env.NODE_ENV === 'production'
        ? 'Could not send the verification code. Check the server email settings.'
        : `Registration step failed: ${error.message}`
    return res.status(500).json({ message })
  }
}

export const verifyRegistrationCode = async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : ''

    if (!email || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter the six-digit code from your email.' })
    }

    const pending = await PendingRegistration.findOne({ email })
    if (!pending || pending.expiresAt <= new Date()) {
      return res.status(400).json({ message: 'Registration expired. Please start again.' })
    }
    if (pending.verifiedAt) {
      return res.status(200).json({ message: 'Email already verified.' })
    }
    if (pending.otpExpiresAt <= new Date()) {
      return res.status(400).json({ message: 'That code expired. Request a new one.' })
    }
    if (pending.otpAttempts >= 5) {
      return res.status(429).json({ message: 'Too many incorrect codes. Request a new code.' })
    }

    const expected = Buffer.from(pending.otpHash, 'hex')
    const submitted = Buffer.from(hashOtp(email, otp), 'hex')
    if (!timingSafeEqual(expected, submitted)) {
      pending.otpAttempts += 1
      await pending.save()
      return res.status(400).json({ message: 'That code is incorrect.' })
    }

    pending.verifiedAt = new Date()
    pending.otpHash = 'verified'
    await pending.save()
    return res.status(200).json({ message: 'Email verified.' })
  } catch (error) {
    console.error('Verify registration OTP error:', error)
    return res.status(500).json({ message: 'Could not verify the code.' })
  }
}

export const completeRegistration = async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    const { password } = req.body

    if (!email || typeof password !== 'string') {
      return res.status(400).json({ message: 'Email and password are required.' })
    }
    if (password.length < 10) {
      return res.status(400).json({ message: 'Password must be at least 10 characters.' })
    }

    const pending = await PendingRegistration.findOne({ email })
    if (!pending?.verifiedAt || pending.expiresAt <= new Date()) {
      return res.status(400).json({ message: 'Verify your email before creating the account.' })
    }
    if (await User.exists({ $or: [{ email }, { username: pending.username }] })) {
      return res.status(409).json({ message: 'An account already uses that email or username.' })
    }

    const user = await User.create({
      username: pending.username,
      email: pending.email,
      phone: pending.phone,
      password: await bcrypt.hash(password, 12),
      role: pending.accountType === 'rental_shop' ? 'rental_shop' : 'user',
      shopName: pending.shopName || '',
      shopStatus: pending.accountType === 'rental_shop' ? 'pending' : 'not_applicable',
    })

    await PendingRegistration.deleteOne({ _id: pending._id })
    return res.status(201).json({
      message:
        user.role === 'rental_shop'
          ? 'Account created. Your rental shop is awaiting admin approval.'
          : 'Account created successfully.',
      userId: user._id,
    })
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'An account already uses that username or email.' })
    }
    console.error('Complete registration error:', error)
    return res.status(500).json({ message: 'Could not create the account.' })
  }
}

export const login = async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
    const { password } = req.body

    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({ message: 'Email and password are required.' })
    }

    const user = await User.findOne({ email })
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Email or password is incorrect.' })
    }

    if (
      process.env.ADMIN_EMAIL &&
      email === process.env.ADMIN_EMAIL.trim().toLowerCase() &&
      user.role !== 'admin'
    ) {
      user.role = 'admin'
      user.shopStatus = 'not_applicable'
      await user.save()
    }
    if (!user.active)
      return res.status(403).json({ message: 'This account has been suspended. Contact support.' })
    if (user.role === 'rental_shop' && user.shopStatus !== 'approved') {
      return res.status(403).json({
        message: `Your rental shop is ${user.shopStatus}. You can sign in after an administrator approves it.`,
      })
    }

    return res.status(200).json({
      message: 'Signed in successfully.',
      token: createSession(user._id),
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        shopName: user.shopName,
        shopStatus: user.shopStatus,
      },
    })
  } catch (error) {
    console.error('Login error:', error)
    return res.status(500).json({ message: 'Could not sign in. Please try again.' })
  }
}
