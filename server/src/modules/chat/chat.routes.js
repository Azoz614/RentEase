import { Router } from 'express'
import {
  listConversations,
  openConversation,
  readMessages,
  searchContacts,
  sendMessage,
} from './chat.service.mjs'

const router = Router()
const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store')
  next()
}

router.get('/chats', noStore, async (req, res) => res.json(await listConversations(req.user)))
router.get('/chats/search', noStore, async (req, res) =>
  res.json(await searchContacts(req.user, req.query.q)),
)
router.post('/chats', noStore, async (req, res) =>
  res.json(await openConversation(req.user, req.body || {})),
)
router.get('/chats/:id/messages', noStore, async (req, res) =>
  res.json(await readMessages(req.user, req.params.id)),
)
router.post('/chats/:id/messages', noStore, async (req, res) =>
  res.status(201).json(await sendMessage(req.user, req.params.id, req.body?.body)),
)

export default router
