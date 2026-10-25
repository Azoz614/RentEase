import { Router } from 'express'
import {
  sendAccountCode,
  sendEmailChangeCode,
  rejectLegacyProfileChange,
  updateProfile,
  updatePassword,
  rejectLegacyAddressChange,
} from './account.controller.js'

const router = Router()

router.post('/account/otp/send', sendAccountCode)
router.post('/account/email-otp/send', sendEmailChangeCode)
router.put('/profile', rejectLegacyProfileChange)
router.put('/account/profile', updateProfile)
router.put('/account/password', updatePassword)
router.put('/address', rejectLegacyAddressChange)

export default router
