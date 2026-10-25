import { Router } from 'express'
import { requireUser } from '../middleware/auth.mjs'
import { verificationError } from '../middleware/workflow-error.mjs'
import publicCatalogRoutes from '../modules/products/public-catalog.routes.js'
import catalogRoutes from '../modules/products/catalog.routes.js'
import accountRoutes from '../modules/users/account.routes.js'
import deliveryRoutes from '../modules/delivery/delivery.routes.js'
import paymentRoutes from '../modules/payments/payment.routes.js'
import rentalRoutes from '../modules/rentals/rental.routes.js'
import ownerProductRoutes from '../modules/products/owner-product.routes.js'
import notificationRoutes from '../modules/notifications/notification.routes.js'

const router = Router()
router.use(publicCatalogRoutes)
router.use(requireUser)
router.use(catalogRoutes)
router.use(accountRoutes)
router.use(deliveryRoutes)
router.use(paymentRoutes)
router.use(rentalRoutes)
router.use(ownerProductRoutes)
router.use(notificationRoutes)
router.use(verificationError)

export default router
