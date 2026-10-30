import { DeliveryTask } from './delivery-task.model.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { Notification } from '../notifications/notification.model.mjs'
import { Conversation } from '../chat/chat.model.mjs'

// Every open event stream in this process shares one change stream per collection,
// so MongoDB connection use stays flat as more dashboards are opened. This matters
// on Cloudflare, where one Durable Object serves every stream with a small pool.
const watched = [
  [
    DeliveryTask,
    (d, user, is) =>
      user.role === 'admin' ||
      is(d.customerId) ||
      is(d.providerId) ||
      is(d.assignedPartner) ||
      d.offeredPartnerIds?.some(is),
  ],
  [
    RentalRequest,
    (r, user, is) =>
      user.role === 'admin' ||
      is(r.customerId) ||
      r.items?.some((i) => is(i.providerId) || is(i.assignedPartner)),
  ],
  [Notification, (n, _user, is) => is(n.userId)],
  // Every chat message updates its conversation, so both sides refresh their chat.
  [Conversation, (c, _user, is) => is(c.customerId) || is(c.shopId)],
]

const subscribers = new Set()
let cursors = []

function startWatching() {
  cursors = watched.map(([model, visible]) => {
    const cursor = model.watch(
      [{ $match: { operationType: { $in: ['insert', 'update', 'replace'] } } }],
      { fullDocument: 'updateLookup' },
    )
    cursor.on('change', (change) => {
      if (!change.fullDocument) return
      for (const subscriber of subscribers)
        if (visible(change.fullDocument, subscriber.user, subscriber.is)) subscriber.send()
    })
    // Clients reconnect on their own; the next subscriber reopens fresh streams.
    cursor.on('error', () => {
      for (const subscriber of [...subscribers]) subscriber.stop()
    })
    return cursor
  })
}

function stopWatching() {
  for (const cursor of cursors) cursor.close().catch(() => {})
  cursors = []
}

export function deliveryEvents(req, res) {
  res
    .status(200)
    .set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
  res.flushHeaders()
  const uid = String(req.user._id)
  const subscriber = {
    user: req.user,
    is: (id) => id && String(id) === uid,
    closed: false,
    send() {
      if (!subscriber.closed) res.write('data: {"type":"delivery.changed"}\n\n')
    },
    stop() {
      if (subscriber.closed) return
      subscriber.closed = true
      clearInterval(heartbeat)
      clearTimeout(renew)
      subscribers.delete(subscriber)
      if (!subscribers.size) stopWatching()
      res.end()
    },
  }
  const heartbeat = setInterval(() => {
    if (!subscriber.closed) res.write(': heartbeat\n\n')
  }, 20000)
  // Periodic reconnects run authentication again; tokens never appear in URLs.
  const renew = setTimeout(subscriber.stop, 5 * 60000)
  res.on('close', subscriber.stop)
  subscribers.add(subscriber)
  if (!cursors.length) startWatching()
  subscriber.send()
}
