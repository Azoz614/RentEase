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
  listPendingShops,
  listApprovedShops,
  listRentalRequests,
  reviewShop,
  listProducts,
  updateProduct,
  createProduct,
  deactivateProduct,
} from './admin.controller.js'

const router = Router()

router.use(requireUser, requireAdmin)
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
router.get('/shops/pending', listPendingShops)
router.get('/shops/approved', listApprovedShops)
router.get('/rental-requests', listRentalRequests)
router.patch('/shops/:id/review', reviewShop)
router.get('/products', listProducts)
router.patch('/products/:id', updateProduct)
router.post('/products', createProduct)
router.delete('/products/:id', deactivateProduct)

export default router
