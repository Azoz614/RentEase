import { Router } from 'express'
import { requireUser } from '../../middleware/auth.mjs'
import { commissionReport } from './commission.service.mjs'

const router = Router()
router.get('/commissions', requireUser, async (req, res) => {
  if (!['admin', 'rental_shop', 'delivery_partner'].includes(req.user.role))
    return res.status(403).json({ message: 'Financial reports require an authorized organization, shop, or delivery account.' })
  const { kind, status, from, to } = req.query
  const page = Number(req.query.page || 1)
  if (kind && !['rental', 'delivery'].includes(kind) || status && !['pending', 'earned', 'settled', 'reversed'].includes(status) ||
    !Number.isInteger(page) || page < 1 || page > 100000 ||
    from && !/^\d{4}-\d{2}-\d{2}$/.test(from) || to && !/^\d{4}-\d{2}-\d{2}$/.test(to))
    return res.status(400).json({ message: 'Choose valid report filters.' })
  const start = from ? new Date(`${from}T00:00:00+05:30`) : undefined
  const end = to ? new Date(`${to}T23:59:59.999+05:30`) : undefined
  if (start && !Number.isFinite(start.getTime()) || end && !Number.isFinite(end.getTime()) || start && end && start > end)
    return res.status(400).json({ message: 'Choose a valid date range.' })
  res.set('Cache-Control', 'private, no-store')
  res.json(await commissionReport({ beneficiaryId: req.user.role === 'admin' ? undefined : req.user._id,
    kind: req.user.role === 'rental_shop' ? 'rental' : req.user.role === 'delivery_partner' ? 'delivery' : kind,
    status, from: start, to: end, page }))
})
export default router
