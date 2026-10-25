import { Router } from 'express'
import { requireUser, requireAdmin } from '../../middleware/auth.mjs'
import {
  getIdentityStatus,
  getIdentityProfile,
  checkNicAvailability,
  submitIdentity,
  readCustomerDocument,
  createIdentityDispute,
  listAddresses,
  createAddress,
  updateAddress,
  makeDefaultAddress,
  updateNotification,
  listCustomerVerifications,
  listIdentityDisputes,
  resolveIdentityDispute,
  getCustomerVerification,
  readVerificationDocument,
  decideVerification,
} from './identity.controller.js'
import { identityError } from './identity-security.service.mjs'
import { verificationError } from '../../middleware/workflow-error.mjs'

const noStore = (_req, res, next) => {
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
  next()
}

const router = Router()

router.use(
  ['/identity', '/addresses', '/admin/customer-verifications', '/notifications'],
  (req, _res, next) => {
    if (
      ['POST', 'PUT', 'PATCH'].includes(req.method) &&
      (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
    )
      return next(
        identityError(400, 'INVALID_BODY', 'Send a JSON object containing the requested fields.'),
      )
    next()
  },
)
router.use(['/identity', '/addresses'], requireUser, noStore, (req, res, next) =>
  req.user.role === 'user'
    ? next()
    : res.status(403).json({ message: 'Customer access is required.' }),
)
router.get('/identity/status', getIdentityStatus)
router.get('/identity/profile', getIdentityProfile)
router.post('/identity/check-nic', checkNicAvailability)
router.post('/identity/submit', submitIdentity)
router.get('/identity/documents/:side', readCustomerDocument)
router.post('/identity/disputes', createIdentityDispute)
router.get('/addresses', listAddresses)
router.post('/addresses', createAddress)
router.put('/addresses/:id', updateAddress)
router.post('/addresses/:id/default', makeDefaultAddress)
router.patch('/notifications/:id', requireUser, noStore, updateNotification)
router.use('/admin/customer-verifications', requireUser, requireAdmin, noStore)
router.get('/admin/customer-verifications', listCustomerVerifications)
router.get('/admin/customer-verifications/disputes', listIdentityDisputes)
router.post('/admin/customer-verifications/disputes/:id/resolve', resolveIdentityDispute)
router.get('/admin/customer-verifications/:id', getCustomerVerification)
router.get('/admin/customer-verifications/:id/documents/:side', readVerificationDocument)
router.post('/admin/customer-verifications/:id/decision', decideVerification)
router.use(verificationError)

export default router
