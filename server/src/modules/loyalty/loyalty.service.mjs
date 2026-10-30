import { RentalRequest } from '../rentals/rental.model.mjs'
import { User } from '../users/user.model.mjs'

// Every 10 points is a level. Each level reached unlocks one reward: 2% off the rental
// amount of any one product in a booking. Rewards used are counted, never points spent.
export const POINTS_PER_LEVEL = 10
export const REWARD_PERCENT = 2

// Points a returned booking earns: one per LKR 1,000 of rent for each item, at least one.
export const pointsForItems = (items) =>
  items.reduce((sum, item) => sum + Math.max(1, Math.floor(Number(item.rentalAmount || 0) / 1000)), 0)

export const loyaltyRewardAmount = (amount) => Math.round(Number(amount || 0) * REWARD_PERCENT) / 100

export function loyaltySummary(user) {
  const points = Math.max(0, Number(user?.loyaltyPoints || 0))
  const level = Math.floor(points / POINTS_PER_LEVEL)
  const rewardsUsed = Math.min(level, Math.max(0, Number(user?.loyaltyRewardsUsed || 0)))
  return {
    points,
    level,
    pointsPerLevel: POINTS_PER_LEVEL,
    pointsIntoLevel: points % POINTS_PER_LEVEL,
    pointsToNextLevel: POINTS_PER_LEVEL - (points % POINTS_PER_LEVEL),
    rewardPercent: REWARD_PERCENT,
    rewardsEarned: level,
    rewardsUsed,
    rewardsAvailable: level - rewardsUsed,
  }
}

// Filter for the conditional write that claims one reward: only while one is still unused.
export const rewardAvailableFilter = {
  $expr: {
    $lt: [
      { $ifNull: ['$loyaltyRewardsUsed', 0] },
      { $floor: { $divide: [{ $ifNull: ['$loyaltyPoints', 0] }, POINTS_PER_LEVEL] } },
    ],
  },
}

// A declined rewarded item, or a cancelled or expired booking, gives the reward back once.
export async function restoreLoyaltyReward(rental, session) {
  if (rental.loyaltyReward?.status !== 'applied') return false
  rental.loyaltyReward.status = 'restored'
  await User.updateOne(
    { _id: rental.customerId, loyaltyRewardsUsed: { $gt: 0 } },
    { $inc: { loyaltyRewardsUsed: -1 } },
    { session },
  )
  return true
}

export async function loyaltyOverview(user) {
  const rentals = await RentalRequest.find({
    customerId: user._id,
    $or: [{ returnVerifiedAt: { $ne: null } }, { 'loyaltyReward.productId': { $exists: true } }],
  })
    .select('items.title items.rentalAmount returnVerifiedAt loyaltyReward createdAt status')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()
  const activity = rentals
    .flatMap((rental) => [
      ...(rental.returnVerifiedAt
        ? [{
            type: 'earned',
            rentalId: rental._id,
            at: rental.returnVerifiedAt,
            points: pointsForItems(rental.items),
            title: rental.items.map((item) => item.title).join(', '),
          }]
        : []),
      ...(rental.loyaltyReward?.productId
        ? [{
            type: rental.loyaltyReward.status === 'restored' ? 'restored' : 'redeemed',
            rentalId: rental._id,
            at: rental.createdAt,
            amount: rental.loyaltyReward.amount,
            percent: rental.loyaltyReward.percent,
            title: rental.loyaltyReward.title,
          }]
        : []),
    ])
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 20)
  return { ...loyaltySummary(user), activity }
}
