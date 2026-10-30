import { Router } from 'express'
import {
  listProducts,
  listPackages,
  quotePackage,
  listWishlist,
  saveWishlistProduct,
  removeWishlistProduct,
  listProductReviews,
  createReview,
  getLoyalty,
} from './catalog.controller.js'

const router = Router()

router.get('/products', listProducts)
router.get('/loyalty', getLoyalty)
router.get('/packages', listPackages)
router.post('/packages/:packageId/quote', quotePackage)
router.get('/wishlist', listWishlist)
router.put('/wishlist/:productId', saveWishlistProduct)
router.delete('/wishlist/:productId', removeWishlistProduct)
router.get('/reviews/product/:productId', listProductReviews)
router.post('/reviews', createReview)

export default router
