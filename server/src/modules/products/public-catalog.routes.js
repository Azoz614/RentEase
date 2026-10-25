import { Router } from 'express'
import {
  listPublicProducts,
  listPublicPackages,
  listPublicReviews,
} from './public-catalog.controller.js'

const router = Router()

router.get('/public/products', listPublicProducts)
router.get('/public/packages', listPublicPackages)
router.get('/public/reviews/product/:productId', listPublicReviews)

export default router
