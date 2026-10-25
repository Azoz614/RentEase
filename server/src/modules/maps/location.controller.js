import mongoose from 'mongoose'
import { User } from '../users/user.model.mjs'
import { Product } from '../products/product.model.mjs'
import { RentalRequest } from '../rentals/rental.model.mjs'
import { DeliveryLocation } from '../delivery/delivery-location.model.mjs'
import { point, locationError } from './location.service.mjs'
import {
  activeRental,
  sharingStage,
  trackableTask,
  returnStage,
  progressBlock,
  deliveryStages,
} from '../delivery/delivery-workflow.service.mjs'
import { requireTransactions } from '../../services/mongo-transactions.mjs'
import { drivingRoute } from '../delivery/delivery-quote.service.mjs'
import { identityRate } from '../identity/identity-security.service.mjs'
import { identityNotification, emailIdentityNotice } from '../identity/identity.service.mjs'
import { inventoryAvailability, availabilityView } from '../products/availability.service.mjs'
import { recordAudit } from '../../services/audit.service.js'

const id = (value) => {
  if (!mongoose.isValidObjectId(value))
    throw locationError(400, 'Invalid rental or product reference.')
  return value
}

const ownItems = (rental, actor) =>
  rental.items.filter(
    (item) =>
      actor.role === 'admin' ||
      (actor.role === 'user' && String(rental.customerId) === String(actor._id)) ||
      (actor.role === 'rental_shop' && String(item.providerId) === String(actor._id)) ||
      (actor.role === 'delivery_partner' && String(item.assignedPartner) === String(actor._id)),
  )

async function task(req) {
  const rental = await RentalRequest.findById(id(req.params.rentalId))
    .select('+handover.return')
    .lean()
  const item =
    rental &&
    ownItems(rental, req.user).find((row) => String(row.productId) === id(req.params.productId))
  if (!item || rental.deliveryMethod !== 'partner')
    throw locationError(404, 'Delivery task not found.')
  const shipment = rental.shipments?.find(
    (row) => String(row.providerId) === String(item.providerId),
  )
  return { rental, item, shipment }
}

export const getShopLocation = async (req, res) => {
  if (!['rental_shop', 'admin'].includes(req.user.role))
    throw locationError(403, 'Shop access required.')
  res.json({ location: req.user.shopLocation || null, address: req.user.shopAddress || '' })
}

export const updateShopLocation = async (req, res) => {
  if (!['rental_shop', 'admin'].includes(req.user.role))
    throw locationError(403, 'Shop access required.')
  const location = point(req.body.location),
    address = typeof req.body.address === 'string' ? req.body.address.trim() : ''
  if (address.length < 5 || address.length > 600)
    throw locationError(400, 'Enter a shop address of 5–600 characters.')
  await User.updateOne(
    { _id: req.user._id },
    { $set: { shopLocation: location, shopAddress: address }, $inc: { __v: 1 } },
    { runValidators: true },
  )
  recordAudit(req, {
    action: 'shop.location.updated',
    entityType: 'user',
    entityId: req.user._id,
    summary: 'Updated own shop pickup location.',
  })
  res.json({ message: 'Shop location saved. Existing booking snapshots are unchanged.' })
}

export const findNearbyRentals = async (req, res) => {
  await identityRate(req.user._id, 'nearby-search', 100)
  if (
    req.query.longitude === undefined ||
    req.query.latitude === undefined ||
    req.query.longitude === '' ||
    req.query.latitude === ''
  )
    throw locationError(400, 'Choose a search location first.')
  const near = point({
    longitude: Number(req.query.longitude),
    latitude: Number(req.query.latitude),
  })
  const km = Number(req.query.km || 10)
  if (!Number.isFinite(km) || km < 1 || km > 100)
    throw locationError(400, 'Choose a search radius from 1 to 100 km.')
  const shops = await User.aggregate([
    {
      $geoNear: {
        near,
        key: 'shopLocation',
        spherical: true,
        distanceField: 'distanceMeters',
        maxDistance: km * 1000,
        query: {
          active: true,
          $or: [{ role: 'admin' }, { role: 'rental_shop', shopStatus: 'approved' }],
        },
      },
    },
    { $limit: 100 },
    { $project: { shopName: 1, username: 1, shopAddress: 1, shopLocation: 1, distanceMeters: 1 } },
  ])
  const products = await Product.find({
    providerId: { $in: shops.map((shop) => shop._id) },
    active: true,
  })
    .select(
      'title category description photos dailyRate hourlyRate weeklyRate longRentalDiscountPercent depositAmount specifications ratingAverage ratingCount providerId leadTimeHours rentalSlots',
    )
    .limit(500)
    .lean()
  const start = req.query.startDate ? new Date(req.query.startDate) : null,
    end = req.query.endDate ? new Date(req.query.endDate) : null
  if (
    (start || end) &&
    (!Number.isFinite(start?.getTime()) || !Number.isFinite(end?.getTime()) || start >= end)
  )
    throw locationError(400, 'Choose valid rental dates.')
  const availability = await inventoryAvailability(products, start, end)
  const rows = products
    .map(({ rentalSlots: _rentalSlots, ...product }) => ({
      ...product,
      ...availabilityView(availability.get(String(product._id))),
      shop: shops.find((shop) => String(shop._id) === String(product.providerId)),
    }))
    .filter((product) => product.available)
    .sort((a, b) => a.shop.distanceMeters - b.shop.distanceMeters)
  res.json({
    products: rows,
    shops,
    distanceType: 'Approximate geographic proximity, not driving distance',
  })
}

export const listDeliveryTasks = async (req, res) => {
  const filter =
    req.user.role === 'admin'
      ? {}
      : req.user.role === 'user'
        ? { customerId: req.user._id }
        : req.user.role === 'rental_shop'
          ? { 'items.providerId': req.user._id }
          : { 'items.assignedPartner': req.user._id }
  const rentals = await RentalRequest.find({
    ...filter,
    deliveryMethod: 'partner',
    status: { $in: ['confirmed', 'active', 'return_in_transit', 'returned'] },
  })
    .select(
      'customerId items status deliveryMethod deliveryWorkflowVersion shipments deliveryDestination address pickupVerifiedAt returnVerifiedAt returnOtpVerifiedAt updatedAt +handover.return',
    )
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean()
  const live = await DeliveryLocation.find({
    rentalId: { $in: rentals.map((rental) => rental._id) },
    expiresAt: { $gt: new Date() },
  }).lean()
  const partnerIds = rentals.flatMap((rental) =>
    ownItems(rental, req.user)
      .map((item) => item.assignedPartner)
      .filter(Boolean),
  )
  const partners = await User.find({ _id: { $in: partnerIds }, active: true })
    .select('username phone')
    .lean()
  const tasks = rentals.flatMap((rental) =>
    ownItems(rental, req.user)
      .filter((item) => item.decision === 'accepted' && item.deliveryStatus !== 'returned')
      .map((item) => {
        const shipment = rental.shipments?.find(
          (row) => String(row.providerId) === String(item.providerId),
        )
        const partner = partners.find((row) => String(row._id) === String(item.assignedPartner))
        const position =
          partner &&
          trackableTask(rental, item) &&
          live.find(
            (row) =>
              String(row.rentalId) === String(rental._id) &&
              String(row.productId) === String(item.productId) &&
              String(row.partnerId) === String(item.assignedPartner),
          )
        const nextStatus = deliveryStages[deliveryStages.indexOf(item.deliveryStatus) + 1]
        return {
          rentalId: rental._id,
          productId: item.productId,
          title: item.title,
          status: item.deliveryStatus,
          nextStatus,
          progressBlocked: nextStatus ? progressBlock(rental, item, nextStatus) : '',
          canShare: Boolean(partner && trackableTask(rental, item)),
          workflowVersion: rental.deliveryWorkflowVersion,
          canAssign:
            rental.deliveryWorkflowVersion !== 2 &&
            ['assigned', 'delivered', 'return_pickup'].includes(item.deliveryStatus),
          type: returnStage(item) ? 'return' : 'delivery',
          shipment,
          destination: rental.deliveryDestination?.location
            ? rental.deliveryDestination
            : { address: rental.address },
          partner: partner
            ? { id: partner._id, name: partner.username, phone: partner.phone || '' }
            : null,
          live: position
            ? {
                location: position.location,
                updatedAt: position.updatedAt,
                expiresAt: position.expiresAt,
                accuracy: position.accuracy,
              }
            : null,
        }
      }),
  )
  const shops =
    req.user.role === 'admin'
      ? await User.find({
          shopLocation: { $exists: true },
          active: true,
          $or: [{ role: 'admin' }, { role: 'rental_shop', shopStatus: 'approved' }],
        })
          .select('shopName username shopLocation')
          .limit(200)
          .lean()
      : []
  res.json({ tasks, shops })
}

export const getTaskRoute = async (req, res) => {
  await identityRate(req.user._id, 'task-route', 30)
  const { rental, item, shipment } = await task(req)
  if (
    !activeRental(rental) ||
    item.decision !== 'accepted' ||
    !shipment?.origin ||
    !rental.deliveryDestination?.location
  )
    throw locationError(409, 'This task has no active route or saved location snapshot.')
  const returning = returnStage(item)
  let origin = returning ? rental.deliveryDestination.location : shipment.origin
  let destination = returning ? shipment.origin : rental.deliveryDestination.location
  if (req.body.origin !== undefined) {
    if (req.user.role !== 'delivery_partner' || !trackableTask(rental, item))
      throw locationError(
        403,
        'Only the assigned partner can route from their current position during an active trip.',
      )
    origin = point(req.body.origin)
    destination = ['assigned', 'heading_to_shop', 'arrived_at_shop'].includes(item.deliveryStatus)
      ? shipment.origin
      : ['return_pickup', 'heading_to_customer'].includes(item.deliveryStatus)
        ? rental.deliveryDestination.location
        : destination
  }
  res.json(await drivingRoute(origin, destination, true))
}

export const updateTaskSharing = async (req, res) => {
  if (req.user.role !== 'delivery_partner')
    throw locationError(403, 'Delivery partner access required.')
  const { rental, item } = await task(req)
  const filter = { rentalId: rental._id, productId: item.productId, partnerId: req.user._id }
  if (req.body.enabled === false) {
    await DeliveryLocation.deleteOne(filter)
    return res.json({ sharing: false })
  }
  if (req.body.enabled !== true || !trackableTask(rental, item))
    throw locationError(409, 'Sharing is allowed only during your active assigned delivery.')
  await identityRate(req.user._id, 'location-sharing', 1200)
  const existing = await DeliveryLocation.findOne(filter).select('updatedAt').lean()
  if (existing && Date.now() - existing.updatedAt.getTime() < 12000)
    throw locationError(429, 'Location was just updated. Wait before sending another update.')
  const accuracy = Number(req.body.accuracy)
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 5000)
    throw locationError(400, 'A sufficiently accurate device location is required.')
  const updatedAt = new Date(),
    expiresAt = new Date(Date.now() + 90000)
  await DeliveryLocation.findOneAndUpdate(
    { rentalId: rental._id, productId: item.productId },
    { $set: { ...filter, location: point(req.body.location), accuracy, updatedAt, expiresAt } },
    { upsert: true, runValidators: true },
  )
  // Recheck after the write: reassignment or completion may have raced a device update.
  const stillAssigned = await RentalRequest.exists({
    _id: rental._id,
    status: rental.status,
    items: {
      $elemMatch: {
        productId: item.productId,
        assignedPartner: req.user._id,
        deliveryStatus: item.deliveryStatus,
        decision: 'accepted',
      },
    },
  })
  if (!stillAssigned) {
    await DeliveryLocation.deleteOne({ ...filter, updatedAt })
    throw locationError(409, 'The delivery changed. Location sharing has stopped.')
  }
  res.json({ sharing: true, expiresAt })
}

export const listAvailablePartners = async (req, res) => {
  await identityRate(req.user._id, 'nearby-partners', 100)
  const { shipment } = await task(req)
  const partners = await User.find({ role: 'delivery_partner', active: true })
    .select('username')
    .lean()
  const jobs = await RentalRequest.find({
    deliveryMethod: 'partner',
    status: { $in: ['pending', 'confirmed', 'active', 'returned'] },
  })
    .select('items status deliveryMethod')
    .lean()
  const positions = shipment?.origin
    ? await DeliveryLocation.aggregate([
        {
          $geoNear: {
            near: point(shipment.origin),
            key: 'location',
            spherical: true,
            distanceField: 'distanceMeters',
            query: { expiresAt: { $gt: new Date() } },
          },
        },
      ])
    : []
  const valid = positions.filter((position) =>
    jobs.some(
      (job) =>
        String(job._id) === String(position.rentalId) &&
        job.items.some(
          (item) =>
            String(item.productId) === String(position.productId) &&
            String(item.assignedPartner) === String(position.partnerId) &&
            trackableTask(job, item),
        ),
    ),
  )
  res.json({
    partners: partners
      .map((partner) => {
        const meters = valid.find(
          (row) => String(row.partnerId) === String(partner._id),
        )?.distanceMeters
        const activeTasks = jobs.reduce(
          (count, job) =>
            count +
            job.items.filter(
              (item) => String(item.assignedPartner) === String(partner._id) && sharingStage(item),
            ).length,
          0,
        )
        return {
          id: partner._id,
          name: partner.username,
          distanceKm: meters == null ? null : meters / 1000,
          activeTasks,
          available: activeTasks === 0,
        }
      })
      .sort(
        (a, b) =>
          Number(b.available) - Number(a.available) ||
          (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
      ),
    locationNotice:
      'Idle partners have no live location. Only partners sharing during active assignments can be ranked by geographic proximity.',
  })
}

export const assignTaskPartner = async (req, res) => {
  const { rental, item } = await task(req)
  if (rental.deliveryWorkflowVersion === 2)
    throw locationError(409, 'Partners must accept new delivery tasks themselves.')
  if (
    !activeRental(rental) ||
    item.decision !== 'accepted' ||
    !['assigned', 'delivered', 'return_pickup'].includes(item.deliveryStatus)
  )
    throw locationError(409, 'Reassignment is allowed before an accepted trip starts.')
  const partnerId = id(req.body.partnerId)
  await requireTransactions()
  await mongoose.connection.transaction(async (session) => {
    const partner = await User.findOne({
      _id: partnerId,
      role: 'delivery_partner',
      active: true,
      activeDeliveryTask: null,
    })
      .select('_id')
      .session(session)
    if (!partner) throw locationError(400, 'Choose an active delivery partner.')
    const jobs = await RentalRequest.find({
      deliveryMethod: 'partner',
      status: { $in: ['pending', 'confirmed', 'active', 'returned'] },
      'items.assignedPartner': partnerId,
    })
      .select('items status deliveryMethod')
      .session(session)
      .lean()
    if (
      jobs.some((job) =>
        job.items.some(
          (row) =>
            String(row.assignedPartner) === String(partnerId) &&
            sharingStage(row) &&
            !(
              String(job._id) === String(rental._id) &&
              String(row.providerId) === String(item.providerId)
            ),
        ),
      )
    )
      throw locationError(
        409,
        'This partner has another active trip. Choose an available partner or wait for that trip to finish.',
      )
    await User.updateOne({ _id: partnerId }, { $inc: { __v: 1 } }, { session })
    const result = await RentalRequest.updateOne(
      {
        _id: rental._id,
        __v: rental.__v,
        status: rental.status,
        items: {
          $elemMatch: {
            productId: item.productId,
            deliveryStatus: item.deliveryStatus,
            decision: 'accepted',
          },
        },
      },
      { $set: { 'items.$.assignedPartner': partnerId }, $inc: { __v: 1 } },
      { session },
    )
    if (!result.modifiedCount) throw locationError(409, 'The task changed. Refresh and try again.')
    await DeliveryLocation.deleteOne(
      { rentalId: rental._id, productId: item.productId },
      { session },
    )
    await identityNotification(
      partnerId,
      'Delivery Assigned',
      'Review your delivery workspace for your assigned task.',
      'requests',
      session,
      rental._id,
    )
  })
  await emailIdentityNotice(
    partnerId,
    'Delivery Assigned',
    'Review your delivery workspace for your assigned task.',
  )
  recordAudit(req, {
    action: 'delivery.assigned',
    entityType: 'rental_request',
    entityId: rental._id,
    summary: 'Administrator updated the assigned delivery partner.',
  })
  res.json({ message: 'Delivery partner assigned.' })
}
