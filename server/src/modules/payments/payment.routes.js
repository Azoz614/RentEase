import { Router } from 'express'
import {
  validateCoupon,
  recordPayment,
  downloadInvoice,
  recordAdjustment,
  refundDeposit,
} from './payment.controller.js'

const router = Router()

router.post('/coupons/validate', validateCoupon)
router.post('/requests/:requestId/payments', recordPayment)
router.get('/requests/:requestId/invoice', downloadInvoice)
router.post('/provider/requests/:requestId/adjustments', recordAdjustment)
router.post('/provider/requests/:requestId/deposit/refund', refundDeposit)

export default router
