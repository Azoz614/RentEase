import mongoose from 'mongoose'

const { ObjectId } = mongoose.Schema.Types

// One conversation per customer and rental shop. Each side only ever sees the other's display
// name, so chatting never reveals an email address, phone number or home address.
const conversationSchema = new mongoose.Schema(
  {
    customerId: { type: ObjectId, ref: 'User', required: true },
    shopId: { type: ObjectId, ref: 'User', required: true, index: true },
    // The listing or booking the chat was last opened from, shown as its subject.
    subject: { productId: ObjectId, requestId: ObjectId, title: { type: String, maxlength: 200 } },
    lastMessage: { body: String, side: String, at: Date },
    customerUnread: { type: Number, default: 0, min: 0 },
    shopUnread: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
)
conversationSchema.index({ customerId: 1, shopId: 1 }, { unique: true })

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: ObjectId, ref: 'Conversation', required: true },
    senderId: { type: ObjectId, ref: 'User', required: true },
    side: { type: String, enum: ['customer', 'shop'], required: true },
    // Hidden contact details can make a stored body longer than the 1,000 characters typed.
    body: { type: String, required: true, maxlength: 2000 },
    contactHidden: { type: Boolean, default: false },
  },
  { timestamps: true },
)
messageSchema.index({ conversationId: 1, createdAt: -1 })
messageSchema.index({ senderId: 1, createdAt: -1 })

export const Conversation = mongoose.model('Conversation', conversationSchema)
export const ChatMessage = mongoose.model('ChatMessage', messageSchema)
