import 'dotenv/config'
import mongoose from 'mongoose'
import { RentalRequest } from '../src/modules/rentals/rental.model.mjs'
import { VerificationRate } from '../src/modules/otp/verification-rate.model.mjs'

// Dry-run by default. Only records with no status are eligible; no pickup/return evidence is invented.
const missingStatus = { $or: [{ status: { $exists: false } }, { status: null }] }
try {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false,
    autoCreate: false,
  })
  const candidates = await RentalRequest.collection.countDocuments(missingStatus)
  if (!process.argv.includes('--apply')) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          recordsMissingStatus: candidates,
          changes:
            'Derive confirmed/cancelled/pending from existing item decisions; add migration history. No handover timestamps are backfilled.',
        },
        null,
        2,
      ),
    )
  } else {
    const decisions = {
      $map: { input: { $ifNull: ['$items', []] }, as: 'item', in: '$$item.decision' },
    }
    const nonEmpty = { $gt: [{ $size: { $ifNull: ['$items', []] } }, 0] }
    const derivedStatus = {
      $switch: {
        branches: [
          {
            case: { $and: [nonEmpty, { $setIsSubset: [decisions, ['accepted']] }] },
            then: 'confirmed',
          },
          {
            case: { $and: [nonEmpty, { $setIsSubset: [decisions, ['rejected']] }] },
            then: 'cancelled',
          },
        ],
        default: 'pending',
      },
    }
    const result = await RentalRequest.collection.updateMany(missingStatus, [
      {
        $set: {
          status: derivedStatus,
          updatedAt: '$$NOW',
          __v: { $add: [{ $ifNull: ['$__v', 0] }, 1] },
        },
      },
      {
        $set: {
          statusHistory: {
            $concatArrays: [
              { $ifNull: ['$statusHistory', []] },
              [
                {
                  _id: new mongoose.Types.ObjectId(),
                  status: '$status',
                  action: 'migration.status.initialized',
                  at: '$$NOW',
                  note: 'Initialized legacy status from existing item decisions. No handover was verified by this migration.',
                },
              ],
            ],
          },
        },
      },
    ])
    // Add indexes only: never syncIndexes(), which could drop existing indexes.
    await RentalRequest.createIndexes()
    await VerificationRate.createIndexes()
    console.log(
      JSON.stringify(
        {
          mode: 'apply',
          modified: result.modifiedCount,
          indexes: 'created without dropping existing indexes',
        },
        null,
        2,
      ),
    )
  }
} catch (error) {
  console.error(
    `Rental migration failed (${error.name}). Check database connectivity and permissions.`,
  )
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
