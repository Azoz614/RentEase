// Mirrors server/src/modules/loyalty/loyalty.service.mjs so checkout totals match the booking.
export const POINTS_PER_LEVEL = 10
export const REWARD_PERCENT = 2

export const loyaltyRewardAmount = (amount) => Math.round(Number(amount || 0) * REWARD_PERCENT) / 100

export const emptyLoyalty = {
  points: 0,
  level: 0,
  pointsPerLevel: POINTS_PER_LEVEL,
  pointsIntoLevel: 0,
  pointsToNextLevel: POINTS_PER_LEVEL,
  rewardPercent: REWARD_PERCENT,
  rewardsEarned: 0,
  rewardsUsed: 0,
  rewardsAvailable: 0,
}

const tiers = [
  { from: 0, name: 'Explorer', tone: 'mint' },
  { from: 3, name: 'Adventurer', tone: 'sky' },
  { from: 6, name: 'Trailblazer', tone: 'violet' },
  { from: 10, name: 'Legend', tone: 'gold' },
]
// A name and colour for a level, so each card in the level track feels distinct.
export const tierFor = (level) => [...tiers].reverse().find((tier) => level >= tier.from)

// Trending = most currently reserved, then best rated, then most reviewed.
export const trendingProducts = (products, limit = 8) =>
  [...products]
    .filter((product) => product.availabilityStatus !== 'on_rental')
    .sort(
      (a, b) =>
        Number(b.bookingCount || 0) - Number(a.bookingCount || 0) ||
        Number(b.ratingAverage || 0) * Number(b.ratingCount || 0) -
          Number(a.ratingAverage || 0) * Number(a.ratingCount || 0) ||
        Number(b.ratingCount || 0) - Number(a.ratingCount || 0),
    )
    .slice(0, limit)
