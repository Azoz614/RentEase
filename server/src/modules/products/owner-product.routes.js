import { Router } from 'express'
import {
  listOwnerProducts,
  createOwnerProduct,
  updateOwnerProduct,
  listOwnerReviews,
} from './owner-product.controller.js'

const router = Router()

router.get('/owner/products', listOwnerProducts)
router.post('/owner/products', createOwnerProduct)
router.patch('/owner/products/:id', updateOwnerProduct)
router.get('/owner/reviews', listOwnerReviews)

export default router
