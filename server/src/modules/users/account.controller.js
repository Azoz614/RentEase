import bcrypt from 'bcryptjs'
import { randomInt } from 'node:crypto'
import { User } from './user.model.mjs'
import { sendAccountOtp } from '../../config/mailer.js'
import { recordAudit } from '../../services/audit.service.js'
import { AccountOtp } from '../otp/account-otp.model.mjs'
import { mapsKey } from '../delivery/delivery-quote.service.mjs'

import {
  otpSecret,
  hashAccountOtp,
  verifyAccountChange,
  consumeAccountOtp,
} from '../otp/account-otp.service.mjs'

export const sendAccountCode = async (req, res) => {
  if (req.user.role !== 'user')
    return res
      .status(403)
      .json({ message: 'Customer account security is only available to customer accounts.' })
  const purpose = req.body.purpose
  if (!['profile_update', 'password_change'].includes(purpose))
    return res.status(400).json({ message: 'Choose a valid account change to verify.' })
  if (!otpSecret())
    return res
      .status(503)
      .json({ message: 'Email verification is not configured. Set OTP_SECRET and email settings.' })
  const previous = await AccountOtp.findOne({ userId: req.user._id, purpose, targetEmail: '' })
  if (previous && Date.now() - previous.updatedAt.getTime() < 60_000)
    return res.status(429).json({ message: 'Wait one minute before requesting another code.' })
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await AccountOtp.findOneAndUpdate(
    { userId: req.user._id, purpose },
    {
      $set: {
        targetEmail: '',
        otpHash: hashAccountOtp(req.user._id, purpose, otp),
        expiresAt: new Date(Date.now() + 10 * 60_000),
        attempts: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  try {
    await sendAccountOtp(req.user.email, otp, purpose)
  } catch (error) {
    await AccountOtp.deleteOne({ userId: req.user._id, purpose })
    console.error('Account verification email failed:', error.message)
    return res.status(503).json({
      message: 'Could not send the verification code. Check the email settings and try again.',
    })
  }
  res.json({ message: `A verification code was sent to ${req.user.email}.` })
}

export const sendEmailChangeCode = async (req, res) => {
  if (req.user.role !== 'user')
    return res
      .status(403)
      .json({ message: 'Customer account settings are only available to customer accounts.' })
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ message: 'Enter a valid new email address.' })
  if (email === req.user.email)
    return res.status(400).json({ message: 'This is already your account email.' })
  if (await User.exists({ email }))
    return res.status(409).json({ message: 'Another account already uses this email address.' })
  if (!otpSecret())
    return res
      .status(503)
      .json({ message: 'Email verification is not configured. Set OTP_SECRET and email settings.' })
  const previous = await AccountOtp.findOne({
    userId: req.user._id,
    purpose: 'email_change',
    targetEmail: email,
  })
  if (previous && Date.now() - previous.updatedAt.getTime() < 60_000)
    return res.status(429).json({ message: 'Wait one minute before requesting another code.' })
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0')
  await AccountOtp.findOneAndUpdate(
    { userId: req.user._id, purpose: 'email_change' },
    {
      $set: {
        targetEmail: email,
        otpHash: hashAccountOtp(req.user._id, 'email_change', otp, email),
        expiresAt: new Date(Date.now() + 10 * 60_000),
        attempts: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  try {
    await sendAccountOtp(email, otp, 'email_change')
  } catch (error) {
    await AccountOtp.deleteOne({ userId: req.user._id, purpose: 'email_change' })
    console.error('New email verification failed:', error.message)
    return res.status(503).json({
      message:
        'Could not send a verification code to that email. Check the email settings and try again.',
    })
  }
  res.json({ message: `A verification code was sent to ${email}.` })
}

export const rejectLegacyProfileChange = (_req, res) =>
  res.status(409).json({
    message:
      'Use Identity verification to update your NIC and Address book to securely update your residential address.',
    code: 'SECURE_PROFILE_REQUIRED',
  })

export const updateProfile = async (req, res) => {
  if (req.user.role !== 'user')
    return res
      .status(403)
      .json({ message: 'Customer account settings are only available to customer accounts.' })
  const username = typeof req.body.username === 'string' ? req.body.username.trim() : ''
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : ''
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const nic =
    typeof req.body.nic === 'string' ? req.body.nic.trim().toUpperCase().replace(/\s+/g, '') : ''
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : ''
  if (username.length < 2 || username.length > 50)
    return res.status(400).json({ message: 'Name must be between 2 and 50 characters.' })
  if (phone.length < 7 || phone.length > 24 || !/^[+\d().\s-]+$/.test(phone))
    return res.status(400).json({ message: 'Enter a valid contact phone number.' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ message: 'Enter a valid email address.' })
  if (nic)
    return res.status(409).json({
      message: 'Update NIC details through Identity verification so they can be reviewed again.',
    })
  if (address !== (req.user.defaultAddress || ''))
    return res.status(409).json({
      message: 'Use Address book to update your residential address with password confirmation.',
    })
  if (typeof req.body.password !== 'string' || !req.body.password)
    return res.status(400).json({ message: 'Enter your current password to save profile changes.' })
  const conflict = await User.findOne({
    _id: { $ne: req.user._id },
    $or: [{ username }, { email }],
  }).select('username email')
  if (conflict)
    return res.status(409).json({
      message:
        conflict.email === email
          ? 'Another account already uses this email address.'
          : 'That name is already in use.',
    })
  await verifyAccountChange(req, 'profile_update')
  if (email !== req.user.email) {
    const newEmailOtp = typeof req.body.emailOtp === 'string' ? req.body.emailOtp.trim() : ''
    if (!/^\d{6}$/.test(newEmailOtp))
      return res
        .status(400)
        .json({ message: 'Verify your new email address with its six-digit code.' })
    await consumeAccountOtp(req.user._id, 'email_change', newEmailOtp, email)
  }
  const update = { username, phone, email }
  try {
    const saved = await User.findByIdAndUpdate(
      req.user._id,
      { $set: update, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    ).select('username email phone defaultAddress')
    recordAudit(req, {
      action: 'profile.updated',
      entityType: 'user',
      entityId: req.user._id,
      summary: 'Updated account, contact, identity, and default address details.',
    })
    res.json({
      message: 'Account details saved.',
      user: { username: saved.username, email: saved.email, phone: saved.phone },
      nic: '',
      address: saved.defaultAddress,
      mapsConfigured: Boolean(mapsKey()),
    })
  } catch (error) {
    if (error.code === 11000)
      return res.status(409).json({ message: 'That name or email address is already in use.' })
    throw error
  }
}

export const updatePassword = async (req, res) => {
  if (req.user.role !== 'user')
    return res
      .status(403)
      .json({ message: 'Customer account settings are only available to customer accounts.' })
  const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : ''
  if (newPassword.length < 10 || newPassword.length > 128)
    return res.status(400).json({ message: 'Choose a password between 10 and 128 characters.' })
  await verifyAccountChange(req, 'password_change')
  const account = await User.findById(req.user._id)
  if (await bcrypt.compare(newPassword, account.password))
    return res
      .status(400)
      .json({ message: 'Choose a new password that differs from your current password.' })
  account.password = await bcrypt.hash(newPassword, 12)
  await account.save()
  recordAudit(req, {
    action: 'account.password.updated',
    entityType: 'user',
    entityId: req.user._id,
    summary: 'Changed account password.',
  })
  res.json({ message: 'Password changed successfully.' })
}

export const rejectLegacyAddressChange = (_req, res) =>
  res.status(409).json({
    message: 'Use the password-protected structured Address book to update your default address.',
    code: 'SECURE_ADDRESS_REQUIRED',
  })

export const getCurrentUser = async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('-password -identityFrontPath -identityBackPath')
    .lean()
  res.json({ user })
}
