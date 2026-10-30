import { randomUUID } from 'node:crypto'
import mongoose from 'mongoose'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { User } from '../users/user.model.mjs'
import { recordAudit } from '../../services/audit.service.js'

import { notify } from '../notifications/rental-notifications.service.mjs'
import { priceCoupon } from './coupon.service.mjs'
import { depositFor, adjustmentTotal, invoiceNumber, invoicePdf } from './payment.service.mjs'
import {
  publicRequest,
  canManageRequest,
  controlsWholeRequest,
  SHARED_BOOKING_MESSAGE,
} from '../rentals/rental-workflow.service.mjs'
import { recordRentalCommissions } from './commission.service.mjs'
import { customerRentalViews } from '../rentals/customer-rentals.service.mjs'

// Customers get the same field-limited view as My rentals, never the raw booking document.
const customerView = async (request) => (await customerRentalViews([request.toObject ? request.toObject() : request]))[0]

export const validateCoupon = async (req, res) => {
  const subtotal = Number(req.body.subtotal)
  if (!Number.isFinite(subtotal) || subtotal < 0)
    return res.status(400).json({ message: 'The rental subtotal is not valid.' })
  try {
    const { coupon, discountAmount } = await priceCoupon(req.body.code, subtotal)
    if (!coupon) return res.status(400).json({ message: 'Enter a coupon code.' })
    res.json({ code: coupon.code, discountAmount, totalAfterDiscount: subtotal - discountAmount })
  } catch (error) {
    res.status(400).json({ message: error.message })
  }
}

export const recordPayment = async (req, res) => {
  const key = req.get('idempotency-key') || req.body.idempotencyKey || ''
  if (!/^[A-Za-z0-9_-]{12,128}$/.test(key))
    return res.status(400).json({ message: 'Send a unique Idempotency-Key for this payment.' })
  let request = await RentalRequest.findOne({
    _id: req.params.requestId,
    customerId: req.user._id,
  })
  if (!request) return res.status(404).json({ message: 'Rental booking not found.' })
  if (request.payment?.idempotencyKey === key && request.payment.status !== 'unpaid')
    return res.json({
      message: 'This payment was already processed.',
      request: await customerView(request),
      idempotent: true,
    })
  if (
    request.status !== 'confirmed' ||
    !request.items.every((item) => item.decision === 'accepted')
  )
    return res
      .status(409)
      .json({ message: 'Payment becomes available once every rental item is confirmed.' })
  if (request.payment?.status !== 'unpaid')
    return res.status(409).json({ message: 'This booking has already been paid.' })
  const provider = process.env.PAYMENT_PROVIDER || 'sandbox'
  if (!['sandbox', 'stripe', 'payhere'].includes(provider))
    return res.status(503).json({ message: 'No supported payment provider is configured.' })
  if (provider !== 'sandbox')
    return res.status(503).json({
      message: `${provider} checkout is not connected yet. Set PAYMENT_PROVIDER=sandbox for local verification.`,
    })
  // The sandbox collects no money; a live site must not treat it as paid and record commission.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SANDBOX_PAYMENTS !== 'true')
    return res.status(503).json({
      message: 'Online payment is not available yet. The shop will contact you to arrange payment.',
    })
  let held = depositFor(request)
  let idempotent = false
  try {
  await mongoose.connection.transaction(async (session) => {
  request = await RentalRequest.findOne({ _id: req.params.requestId, customerId: req.user._id }).session(session)
  if (!request || request.status !== 'confirmed' || !request.items.every((item) => item.decision === 'accepted'))
    throw Object.assign(new Error('This booking changed. Refresh before paying.'), { status: 409 })
  if (request.payment?.idempotencyKey === key && request.payment.status !== 'unpaid') { idempotent = true; return }
  if (request.payment?.status !== 'unpaid') throw Object.assign(new Error('This booking has already been paid.'), { status: 409 })
  held = depositFor(request)
  request.payment = {
    status: 'authorized',
    provider,
    idempotencyKey: key,
    transactionId: `sandbox_${randomUUID()}`,
    rentalPaid: Number(request.total),
    depositHeld: held,
    depositRefunded: 0,
    paidAt: new Date(),
    adjustments: [],
  }
  request.invoiceNumber = invoiceNumber()
  request.commissionVersion = 1
  request.invoiceIssuedAt = new Date()
  request.statusHistory.push({
    status: request.status,
    by: req.user._id,
    note: `Sandbox payment authorized: rental LKR ${request.total}, deposit hold LKR ${held}.`,
  })
  await request.save({ session })
  await recordRentalCommissions(request, session)
  })
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Could not record this payment. Please try again.' })
  }
  recordAudit(req, {
    action: 'payment.authorized',
    entityType: 'rental_request',
    entityId: request._id,
    summary: `Authorized rental payment and held deposit for booking ${request.invoiceNumber}.`,
  })
  res.json({
    message: idempotent ? 'This payment was already processed.' : `Sandbox payment confirmed. LKR ${held.toLocaleString('en-LK')} deposit is held until return inspection.`,
    ...(idempotent && { idempotent: true }),
    request: await customerView(request),
  })
}

export const downloadInvoice = async (req, res) => {
  const request = await RentalRequest.findById(req.params.requestId)
  if (
    !request ||
    (String(request.customerId) !== String(req.user._id) && !controlsWholeRequest(request, req.user))
  )
    // The invoice lists every shop's items, so a shop sharing the booking cannot download it.
    return res.status(404).json({ message: 'Invoice not found.' })
  if (!request.invoiceNumber)
    return res.status(409).json({ message: 'An invoice is issued after payment.' })
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${request.invoiceNumber}.pdf"`)
  res.send(invoicePdf(request))
}

export const recordAdjustment = async (req, res) => {
  const type = req.body.type
  const amount = Number(req.body.amount)
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 500) : ''
  if (
    !['late_fee', 'damage_fee'].includes(type) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !note
  )
    return res.status(400).json({
      message: 'Choose a late or damage fee, enter a positive amount, and explain the charge.',
    })
  const request = await RentalRequest.findById(req.params.requestId)
  if (!request || !canManageRequest(request, req.user))
    return res.status(404).json({ message: 'Rental booking not found.' })
  if (!controlsWholeRequest(request, req.user))
    return res.status(403).json({ message: SHARED_BOOKING_MESSAGE })
  if (
    !['active', 'returned', 'disputed'].includes(request.status) ||
    request.payment?.status !== 'authorized'
  )
    return res
      .status(409)
      .json({ message: 'Fees can be recorded for a paid active, returned, or disputed booking.' })
  const remaining = Math.max(0, Number(request.payment.depositHeld || 0) - adjustmentTotal(request))
  if (amount > remaining)
    return res.status(400).json({
      message: `The charge exceeds the remaining held deposit of LKR ${remaining.toLocaleString('en-LK')}.`,
    })
  request.payment.adjustments.push({ type, amount, note, createdBy: req.user._id })
  await request.save()
  const customer = await User.findById(request.customerId).select('email username phone')
  await notify(
    customer,
    request._id,
    type === 'late_fee' ? 'Late fee recorded' : 'Damage fee recorded',
    `${type === 'late_fee' ? 'Late' : 'Damage'} fee of LKR ${amount.toLocaleString('en-LK')}: ${note}`,
  )
  recordAudit(req, {
    action: type,
    entityType: 'rental_request',
    entityId: request._id,
    summary: `Recorded LKR ${amount} ${type.replace('_', ' ')}.`,
  })
  res.json({
    message: 'Adjustment recorded against the held deposit.',
    request: publicRequest(request),
  })
}

export const refundDeposit = async (req, res) => {
  const request = await RentalRequest.findById(req.params.requestId)
  if (!request || !canManageRequest(request, req.user))
    return res.status(404).json({ message: 'Rental booking not found.' })
  if (!controlsWholeRequest(request, req.user))
    return res.status(403).json({ message: SHARED_BOOKING_MESSAGE })
  if (
    !['returned', 'completed'].includes(request.status) ||
    request.payment?.status !== 'authorized'
  )
    return res.status(409).json({ message: 'Return the deposit after the item has been returned.' })
  const refund = Math.max(0, Number(request.payment.depositHeld || 0) - adjustmentTotal(request))
  request.payment.depositRefunded = refund
  request.payment.refundedAt = new Date()
  request.payment.status =
    refund === Number(request.payment.depositHeld || 0) ? 'refunded' : 'partially_refunded'
  request.statusHistory.push({
    status: request.status,
    by: req.user._id,
    note: `Deposit refund recorded: LKR ${refund}.`,
  })
  await request.save()
  const customer = await User.findById(request.customerId).select('email username phone')
  await notify(
    customer,
    request._id,
    'Deposit refund processed',
    `LKR ${refund.toLocaleString('en-LK')} has been released from your security deposit.`,
  )
  recordAudit(req, {
    action: 'deposit.refunded',
    entityType: 'rental_request',
    entityId: request._id,
    summary: `Refunded LKR ${refund} from the held security deposit.`,
  })
  res.json({
    message: `Deposit refund recorded: LKR ${refund.toLocaleString('en-LK')}.`,
    request: publicRequest(request),
  })
}
