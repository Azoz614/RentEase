import { Router } from 'express'
import { requireAdmin, requireUser } from '../../middleware/auth.mjs'

import {
  getOverview,
  getSettings,
  updateSettings,
  getRevenueReport,
  listUsers,
  listAuditEvents,
  listCoupons,
  createCoupon,
  updateCoupon,
  listPackages,
  createPackage,
  updatePackage,
  createUser,
  updateUser,
  deleteUser,
  listPendingShops,
  listApprovedShops,
  listRentalRequests,
  reviewShop,
  listProducts,
  updateProduct,
  createProduct,
  deleteProduct,
} from './admin.controller.js'
import { confirmApprovalPassword } from '../rentals/decision.service.mjs'

const router = Router()

// Every change made from the admin workspace is confirmed with the administrator's password.
// It travels in a header (URI-encoded, so any character survives) so DELETE requests carry it too.
async function confirmAdminPassword(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  let password = req.get('x-admin-password') || ''
  try {
    password = decodeURIComponent(password)
  } catch {
    password = ''
  }
  await confirmApprovalPassword(req.user._id, password, { purpose: 'to confirm this change' })
  next()
}

router.use(requireUser, requireAdmin, confirmAdminPassword)
router.get('/overview', getOverview)
router.get('/settings', getSettings)
router.patch('/settings', updateSettings)
router.get('/reports/revenue', getRevenueReport)
router.get('/users', listUsers)
router.get('/audit', listAuditEvents)
router.get('/coupons', listCoupons)
router.use('/identity', (_req, res) =>
  res
    .status(410)
    .json({ message: 'Use Customer Verifications for the secure identity review workflow.' }),
)
router.post('/coupons', createCoupon)
router.patch('/coupons/:id', updateCoupon)
router.get('/packages', listPackages)
router.post('/packages', createPackage)
router.patch('/packages/:id', updatePackage)
router.post('/users', createUser)
router.patch('/users/:id', updateUser)
router.delete('/users/:id', deleteUser)
router.get('/shops/pending', listPendingShops)
router.get('/shops/approved', listApprovedShops)
router.get('/rental-requests', listRentalRequests)
router.patch('/shops/:id/review', reviewShop)
router.get('/products', listProducts)
router.patch('/products/:id', updateProduct)
router.post('/products', createProduct)
router.delete('/products/:id', deleteProduct)

export default router
