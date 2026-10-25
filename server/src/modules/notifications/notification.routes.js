import { Router } from 'express'
import { listInbox, markInboxRead } from './notification.controller.js'

const router = Router()

router.get('/inbox', listInbox)
router.patch('/inbox/read', markInboxRead)

export default router
