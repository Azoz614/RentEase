import mongoose from 'mongoose'
import { Conversation, ChatMessage } from './chat.model.mjs'
import { Product } from '../products/product.model.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { User } from '../users/user.model.mjs'

const chatError = (status, message) => Object.assign(new Error(message), { status })

export const MESSAGE_LIMIT = 1000
const MESSAGES_PER_MINUTE = 20
const sides = { user: 'customer', rental_shop: 'shop' }
const ownerField = { customer: 'customerId', shop: 'shopId' }
const otherSide = { customer: 'shop', shop: 'customer' }

function chatSide(user) {
  const side = sides[user.role]
  if (!side) throw chatError(403, 'Chat is available to customers and rental shops.')
  return side
}

// Emails, phone numbers and messaging-app links are replaced so neither side has to share, or
// can be pressured into sharing, contact details. Nine or more digits counts as a phone number,
// which leaves prices, dates and booking numbers readable.
const contactPatterns = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /\b(?:wa\.me|t\.me|m\.me)\/\S*/gi,
  /\+?\d(?:[\s().-]{0,2}\d){8,}/g,
]
export const HIDDEN_CONTACT = '[contact hidden]'

export function hideContactDetails(text) {
  let hidden = false
  const body = contactPatterns.reduce(
    (value, pattern) =>
      value.replace(pattern, () => {
        hidden = true
        return HIDDEN_CONTACT
      }),
    text,
  )
  return { body, hidden }
}

// Only display names cross over to the other side.
function present(conversation, side) {
  const shop = conversation.shopId,
    customer = conversation.customerId
  return {
    _id: conversation._id,
    with:
      side === 'customer'
        ? shop?.shopName || shop?.username || 'Rental shop'
        : customer?.username || 'Customer',
    subject: conversation.subject?.title ? conversation.subject : null,
    lastMessage: conversation.lastMessage?.at ? conversation.lastMessage : null,
    unread: conversation[`${side}Unread`] || 0,
    updatedAt: conversation.updatedAt,
  }
}

const withNames = (query) =>
  query.populate('customerId', 'username').populate('shopId', 'username shopName')

export async function listConversations(user) {
  const side = chatSide(user)
  const conversations = await withNames(
    Conversation.find({ [ownerField[side]]: user._id })
      .sort({ 'lastMessage.at': -1, updatedAt: -1 })
      .limit(100),
  ).lean()
  const rows = conversations.map((conversation) => present(conversation, side))
  return { conversations: rows, unread: rows.reduce((sum, row) => sum + row.unread, 0) }
}

const SEARCH_LIMIT = 10
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Who each side can find and message: customers find rental shops, shops find customers.
const contactScope = {
  customer: { role: 'rental_shop', shopStatus: 'approved', active: true },
  shop: { role: 'user', active: true },
}

// Finds people to message by display name: a shop's name (or owner username) for customers,
// a customer's username for shops. Results carry only the name and an id to open the chat with.
export async function searchContacts(user, query) {
  const side = chatSide(user)
  const text = typeof query === 'string' ? query.trim().slice(0, 60) : ''
  if (text.length < 2) return { results: [] }
  const match = new RegExp(escapeRegex(text), 'i')
  const names = side === 'customer' ? [{ shopName: match }, { username: match }] : [{ username: match }]
  const people = await User.find({ ...contactScope[side], $or: names })
    .select('username shopName')
    .sort(side === 'customer' ? { shopName: 1 } : { username: 1 })
    .limit(SEARCH_LIMIT)
    .lean()
  return {
    results: people.map((person) => ({
      id: person._id,
      name: side === 'customer' ? person.shopName || person.username : person.username,
      kind: side === 'customer' ? 'Rental shop' : 'Customer',
    })),
  }
}

// A chat opens from a listing or booking (which becomes its subject) or with someone found
// through searchContacts ({ contactId }).
export async function openConversation(user, { productId, requestId, contactId } = {}) {
  const side = chatSide(user)
  let customerId, shopId, subject
  if (contactId) {
    if (!mongoose.isValidObjectId(contactId)) throw chatError(404, 'That person was not found.')
    customerId = side === 'customer' ? user._id : contactId
    shopId = side === 'shop' ? user._id : contactId
  } else if (side === 'customer' && productId) {
    if (!mongoose.isValidObjectId(productId)) throw chatError(404, 'Listing not found.')
    const product = await Product.findOne({ _id: productId, active: true })
      .select('title providerId createdBy')
      .lean()
    if (!product) throw chatError(404, 'Listing not found.')
    customerId = user._id
    shopId = product.providerId || product.createdBy
    subject = { productId: product._id, title: product.title }
  } else if (requestId) {
    if (!mongoose.isValidObjectId(requestId)) throw chatError(404, 'Booking not found.')
    const rental = await RentalRequest.findOne({
      _id: requestId,
      ...(side === 'customer' ? { customerId: user._id } : { 'items.providerId': user._id }),
    })
      .select('customerId items.providerId items.title')
      .lean()
    if (!rental) throw chatError(404, 'Booking not found.')
    customerId = rental.customerId
    shopId = side === 'shop' ? user._id : rental.items[0]?.providerId
    const titles = rental.items
      .filter((item) => String(item.providerId) === String(shopId))
      .map((item) => item.title)
    subject = { requestId: rental._id, title: `Booking: ${titles.join(', ')}`.slice(0, 200) }
  } else {
    throw chatError(400, 'Choose who to message.')
  }
  const [shop, customer] = await Promise.all([
    User.exists({ _id: shopId, ...contactScope.customer }),
    User.exists({ _id: customerId, ...contactScope.shop }),
  ])
  if (!shop)
    throw chatError(
      404,
      productId
        ? 'This listing is run by RentEase, so there is no shop to message.'
        : 'This rental shop is not available to chat.',
    )
  if (!customer) throw chatError(404, 'This customer is not available to chat.')
  const filter = { customerId, shopId }
  // A chat started from search keeps whatever subject it already had.
  const upsert = () =>
    Conversation.findOneAndUpdate(filter, subject ? { $set: { subject } } : { $setOnInsert: filter }, {
      upsert: true,
      returnDocument: 'after',
    })
  try {
    await upsert()
  } catch (error) {
    // Two first messages at once: the other request created the conversation.
    if (error.code !== 11000) throw error
    await upsert()
  }
  const conversation = await withNames(Conversation.findOne(filter)).lean()
  return { conversation: present(conversation, side) }
}

async function ownConversation(user, id) {
  const side = chatSide(user)
  if (!mongoose.isValidObjectId(id)) throw chatError(404, 'Conversation not found.')
  const conversation = await withNames(
    Conversation.findOne({ _id: id, [ownerField[side]]: user._id }),
  ).lean()
  if (!conversation) throw chatError(404, 'Conversation not found.')
  return { side, conversation }
}

// Reading a conversation also clears its unread count for the reader.
export async function readMessages(user, id) {
  const { side, conversation } = await ownConversation(user, id)
  const messages = await ChatMessage.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(200)
    .select('side body contactHidden createdAt')
    .lean()
  const unread = `${side}Unread`
  if (conversation[unread])
    await Conversation.updateOne({ _id: conversation._id, [unread]: { $gt: 0 } }, { $set: { [unread]: 0 } })
  return {
    conversation: { ...present(conversation, side), unread: 0 },
    messages: messages.reverse().map((message) => ({ ...message, mine: message.side === side })),
  }
}

export async function sendMessage(user, id, text, now = new Date()) {
  const { side, conversation } = await ownConversation(user, id)
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!trimmed) throw chatError(400, 'Write a message first.')
  if (trimmed.length > MESSAGE_LIMIT)
    throw chatError(400, `Keep messages under ${MESSAGE_LIMIT.toLocaleString('en-US')} characters.`)
  const recipient = conversation[ownerField[otherSide[side]]]?._id
  if (!recipient || !(await User.exists({ _id: recipient, active: true })))
    throw chatError(409, 'This account is not available to chat right now.')
  const recent = await ChatMessage.countDocuments({
    senderId: user._id,
    createdAt: { $gt: new Date(now.getTime() - 60_000) },
  })
  if (recent >= MESSAGES_PER_MINUTE)
    throw Object.assign(chatError(429, 'You are sending messages too quickly. Wait a moment.'), {
      retryAfter: 60,
    })
  const { body, hidden } = hideContactDetails(trimmed)
  const message = await ChatMessage.create({
    conversationId: conversation._id,
    senderId: user._id,
    side,
    body,
    contactHidden: hidden,
  })
  await Conversation.updateOne(
    { _id: conversation._id },
    {
      $set: { lastMessage: { body: body.slice(0, 140), side, at: message.createdAt } },
      $inc: { [`${otherSide[side]}Unread`]: 1 },
    },
  )
  return {
    message: {
      _id: message._id,
      side,
      body,
      contactHidden: hidden,
      createdAt: message.createdAt,
      mine: true,
    },
  }
}

// Used when an administrator deletes an account.
export async function removeConversationsFor(userId) {
  const conversations = await Conversation.find({
    $or: [{ customerId: userId }, { shopId: userId }],
  }).distinct('_id')
  if (!conversations.length) return
  await ChatMessage.deleteMany({ conversationId: { $in: conversations } })
  await Conversation.deleteMany({ _id: { $in: conversations } })
}
