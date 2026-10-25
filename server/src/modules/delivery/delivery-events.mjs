import { DeliveryTask } from './delivery-task.model.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { Notification } from '../notifications/notification.model.mjs'

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
  let closed = false
  const cursors = []
  const send = () => {
    if (!closed) res.write('data: {"type":"delivery.changed"}\n\n')
  }
  const uid = String(req.user._id)
  const is = (id) => id && String(id) === uid
  const stop = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    clearTimeout(renew)
    for (const cursor of cursors) cursor.close().catch(() => {})
    res.end()
  }
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': heartbeat\n\n')
  }, 20000)
  // Periodic reconnects run authentication again; tokens never appear in URLs.
  const renew = setTimeout(stop, 5 * 60000)
  res.on('close', stop)
  const watch = (model, visible) => {
    const cursor = model.watch(
      [{ $match: { operationType: { $in: ['insert', 'update', 'replace'] } } }],
      { fullDocument: 'updateLookup' },
    )
    cursors.push(cursor)
    cursor.on('change', (change) => {
      if (change.fullDocument && visible(change.fullDocument)) send()
    })
    cursor.on('error', stop)
  }
  watch(
    DeliveryTask,
    (d) =>
      req.user.role === 'admin' ||
      is(d.customerId) ||
      is(d.providerId) ||
      is(d.assignedPartner) ||
      d.offeredPartnerIds?.some(is),
  )
  watch(
    RentalRequest,
    (r) =>
      req.user.role === 'admin' ||
      is(r.customerId) ||
      r.items?.some((i) => is(i.providerId) || is(i.assignedPartner)),
  )
  watch(Notification, (n) => is(n.userId))
  send()
}
