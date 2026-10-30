import { useEffect, useMemo, useRef, useState } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { RentalPhoto } from '../../products/components/RentalPhoto.jsx'
import { rentalPrice } from '../../rentals/utils/rentalPricing.js'
import { formatCurrency as money } from '../../../utils/currency.js'
import { loyaltyRewardAmount, tierFor, trendingProducts } from '../utils/loyalty.js'
import '../styles/loyalty.css'

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Counts up to a number once it changes, so points and levels feel earned.
function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(() => (reducedMotion() ? target : 0))
  const from = useRef(value)
  useEffect(() => {
    if (reducedMotion()) {
      from.current = target
      const id = requestAnimationFrame(() => setValue(target))
      return () => cancelAnimationFrame(id)
    }
    const start = performance.now(),
      origin = from.current
    let frame
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - (1 - progress) ** 3
      setValue(Math.round(origin + (target - origin) * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
      else from.current = target
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration])
  return value
}

function Confetti({ burst }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 26 }, (_, index) => ({
        id: `${burst}-${index}`,
        left: 8 + ((index * 37) % 84),
        delay: (index % 7) * 0.04,
        rotate: (index * 47) % 360,
        tone: index % 4,
      })),
    [burst],
  )
  if (!burst || reducedMotion()) return null
  return (
    <div className="lp-confetti" aria-hidden="true">
      {pieces.map((piece) => (
        <i
          key={piece.id}
          className={`tone-${piece.tone}`}
          style={{ left: `${piece.left}%`, animationDelay: `${piece.delay}s`, '--spin': `${piece.rotate}deg` }}
        />
      ))}
    </div>
  )
}

function ProgressRing({ value, max, level }) {
  const radius = 64,
    circumference = 2 * Math.PI * radius
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value))
    return () => cancelAnimationFrame(id)
  }, [value])
  const displayLevel = useCountUp(level)
  return (
    <div className="lp-ring" role="img" aria-label={`Level ${level}, ${value} of ${max} points to the next level`}>
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <defs>
          <linearGradient id="lp-ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--lp-accent-a)" />
            <stop offset="100%" stopColor="var(--lp-accent-b)" />
          </linearGradient>
        </defs>
        <circle className="lp-ring-track" cx="80" cy="80" r={radius} />
        <circle
          className="lp-ring-value"
          cx="80"
          cy="80"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / max)}
        />
      </svg>
      <div className="lp-ring-label">
        <small>LEVEL</small>
        <b>{displayLevel}</b>
      </div>
    </div>
  )
}

function TiltCard({ className = '', children, ...props }) {
  const card = useRef(null)
  const move = (event) => {
    if (reducedMotion() || event.pointerType === 'touch') return
    const box = card.current.getBoundingClientRect()
    const x = (event.clientX - box.left) / box.width - 0.5,
      y = (event.clientY - box.top) / box.height - 0.5
    card.current.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`)
    card.current.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`)
    card.current.style.setProperty('--glare-x', `${((x + 0.5) * 100).toFixed(0)}%`)
  }
  const reset = () => {
    card.current?.style.setProperty('--rx', '0deg')
    card.current?.style.setProperty('--ry', '0deg')
  }
  return (
    <article ref={card} className={`lp-tilt ${className}`} onPointerMove={move} onPointerLeave={reset} {...props}>
      {children}
    </article>
  )
}

function Rail({ label, children }) {
  const rail = useRef(null)
  const scroll = (direction) =>
    rail.current?.scrollBy({ left: direction * rail.current.clientWidth * 0.8, behavior: reducedMotion() ? 'auto' : 'smooth' })
  return (
    <div className="lp-rail-wrap">
      <button type="button" className="lp-rail-arrow previous" aria-label={`Scroll ${label} back`} onClick={() => scroll(-1)}>
        ‹
      </button>
      <div ref={rail} className="lp-rail" role="list" aria-label={label} tabIndex={0}>
        {children}
      </div>
      <button type="button" className="lp-rail-arrow next" aria-label={`Scroll ${label} forward`} onClick={() => scroll(1)}>
        ›
      </button>
    </div>
  )
}

const seenKey = (userId) => `rentease.loyalty.seen-level.${userId}`

export default function LoyaltyPanel({
  api,
  user,
  loyalty,
  products,
  cart,
  days,
  hours,
  billingUnit,
  rewardProductId,
  redeemReward,
  setRewardChoice,
  openProductDetails,
  onBrowse,
}) {
  const [activity, setActivity] = useState(null)
  const [burst, setBurst] = useState(0)
  const [notice, setNotice] = useState('')
  const [celebrate, setCelebrate] = useState(false)
  const points = useCountUp(loyalty.points)
  const tier = tierFor(loyalty.level)
  const nextTier = tierFor(loyalty.level + 1)

  useEffect(() => {
    let active = true
    api('/api/loyalty')
      .then((result) => {
        if (active) setActivity(result.activity || [])
      })
      .catch(() => {
        if (active) setActivity([])
      })
    return () => {
      active = false
    }
  }, [api, loyalty.points, loyalty.rewardsUsed])

  // Celebrate once whenever the customer reaches a level they have not seen yet.
  useEffect(() => {
    let seen = 0
    try {
      seen = Number(localStorage.getItem(seenKey(user._id || user.id)) || 0)
    } catch {
      /* Storage is optional. */
    }
    if (loyalty.level <= seen) return
    const id = requestAnimationFrame(() => {
      setCelebrate(true)
      setBurst((value) => value + 1)
    })
    return () => cancelAnimationFrame(id)
  }, [loyalty.level, user])
  const dismissCelebration = () => {
    setCelebrate(false)
    try {
      localStorage.setItem(seenKey(user._id || user.id), String(loyalty.level))
    } catch {
      /* Storage is optional. */
    }
  }

  const levels = useMemo(() => {
    const count = Math.max(6, loyalty.level + 4)
    return Array.from({ length: count }, (_, index) => {
      const level = index + 1
      return {
        level,
        tier: tierFor(level),
        state: level <= loyalty.level ? 'unlocked' : level === loyalty.level + 1 ? 'next' : 'locked',
        redeemed: level <= loyalty.rewardsUsed,
      }
    })
  }, [loyalty.level, loyalty.rewardsUsed])
  const trending = useMemo(() => trendingProducts(products), [products])
  const priceOf = (product) => rentalPrice(product, days || 1, billingUnit === 'hour' ? hours : null)

  const redeem = (product) => {
    const result = redeemReward(product)
    // An item from another shop opens the "start a new request" dialog instead.
    if (result === 'conflict') return
    if (!result) {
      setNotice('Choose valid rental dates and complete verification on Explore rentals to use your reward.')
      return
    }
    setBurst((value) => value + 1)
    setNotice(`${product.title} is in your request with ${loyalty.rewardPercent}% off.`)
  }

  return (
    <section className={`lp tone-${tier.tone}`} aria-labelledby="lp-title">
      <Confetti burst={burst} />
      {celebrate && (
        <div className="lp-celebrate" role="status">
          <span className="lp-celebrate-badge" aria-hidden="true">
            <UiIcon name="star" size={22} />
          </span>
          <div>
            <b>Level {loyalty.level} unlocked!</b>
            <small>
              You earned a new {loyalty.rewardPercent}% reward. Use it on any one item.
            </small>
          </div>
          <button type="button" onClick={dismissCelebration}>
            Nice!
          </button>
        </div>
      )}

      <header className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-kicker">RENTEASE REWARDS · {tier.name.toUpperCase()}</span>
          <h1 id="lp-title">
            <span className="lp-points" aria-live="polite">{points}</span> points
          </h1>
          <p>
            Every {loyalty.pointsPerLevel} points is a new level, and every level gives you{' '}
            <b>{loyalty.rewardPercent}% off any one product</b>.
          </p>
          <div className="lp-progress" aria-hidden="true">
            {Array.from({ length: loyalty.pointsPerLevel }, (_, index) => (
              <i key={index} className={index < loyalty.pointsIntoLevel ? 'filled' : ''} style={{ animationDelay: `${index * 60}ms` }} />
            ))}
          </div>
          <small className="lp-next">
            {loyalty.pointsToNextLevel} {loyalty.pointsToNextLevel === 1 ? 'point' : 'points'} to Level{' '}
            {loyalty.level + 1}
            {nextTier.name !== tier.name ? ` · ${nextTier.name} tier` : ''}
          </small>
        </div>
        <ProgressRing value={loyalty.pointsIntoLevel} max={loyalty.pointsPerLevel} level={loyalty.level} />
      </header>

      <div className="lp-stats">
        {[
          ['Rewards ready', loyalty.rewardsAvailable, 'tag'],
          ['Rewards earned', loyalty.rewardsEarned, 'star'],
          ['Rewards used', loyalty.rewardsUsed, 'check'],
        ].map(([label, value, icon], index) => (
          <div className="lp-stat" key={label} style={{ animationDelay: `${index * 90}ms` }}>
            <span aria-hidden="true">
              <UiIcon name={icon} size={18} />
            </span>
            <b>{value}</b>
            <small>{label}</small>
          </div>
        ))}
      </div>

      {notice && (
        <div className="lp-notice" role="status">
          <span>{notice}</span>
          {cart.length > 0 && (
            <button type="button" onClick={() => document.getElementById('rental-checkout')?.showModal()}>
              Review request →
            </button>
          )}
        </div>
      )}

      <section className="lp-section" aria-labelledby="lp-wallet">
        <div className="lp-section-heading">
          <h2 id="lp-wallet">Your reward wallet</h2>
          <small>One reward = {loyalty.rewardPercent}% off one item in a booking</small>
        </div>
        {loyalty.rewardsAvailable > 0 ? (
          <div className="lp-tickets">
            {Array.from({ length: Math.min(loyalty.rewardsAvailable, 6) }, (_, index) => (
              <div className="lp-ticket" key={index} style={{ animationDelay: `${index * 80}ms` }}>
                <b>{loyalty.rewardPercent}%</b>
                <span>OFF</span>
                <small>Any one product</small>
              </div>
            ))}
            {loyalty.rewardsAvailable > 6 && <div className="lp-ticket more">+{loyalty.rewardsAvailable - 6}</div>}
          </div>
        ) : (
          loyalty.level > 0 && (
            <p className="lp-empty">All your rewards are in use. Reach the next level for another one.</p>
          )
        )}
        {rewardProductId && (
          <p className="lp-applied">
            <UiIcon name="check" size={16} /> Applied to{' '}
            <b>{products.find((product) => product._id === rewardProductId)?.title || 'an item'}</b> in your
            request.
            <button type="button" onClick={() => setRewardChoice('')}>
              Remove
            </button>
          </p>
        )}
      </section>

      <section className="lp-section" aria-labelledby="lp-levels">
        <div className="lp-section-heading">
          <h2 id="lp-levels">Level journey</h2>
          <small>Swipe to see what is next</small>
        </div>
        <Rail label="Levels">
          {levels.map(({ level, tier: cardTier, state, redeemed }, index) => (
            <TiltCard
              key={level}
              role="listitem"
              className={`lp-level is-${state} tone-${cardTier.tone}`}
              style={{ animationDelay: `${index * 70}ms` }}
              aria-label={`Level ${level}, ${state === 'unlocked' ? (redeemed ? 'reward used' : 'reward ready') : state === 'next' ? 'next level' : 'locked'}`}
            >
              <span className="lp-level-tier">{cardTier.name}</span>
              <b className="lp-level-number">{level}</b>
              <span className="lp-level-points">{level * loyalty.pointsPerLevel} pts</span>
              <span className="lp-level-reward">
                {state === 'unlocked'
                  ? redeemed
                    ? 'Reward used'
                    : `${loyalty.rewardPercent}% reward ready`
                  : state === 'next'
                    ? `${loyalty.pointsToNextLevel} pts to go`
                    : 'Locked'}
              </span>
              {state === 'next' && (
                <span className="lp-level-bar" aria-hidden="true">
                  <i style={{ width: `${(loyalty.pointsIntoLevel / loyalty.pointsPerLevel) * 100}%` }} />
                </span>
              )}
              <span className="lp-level-icon" aria-hidden="true">
                <UiIcon name={state === 'locked' ? 'lock' : state === 'next' ? 'arrow' : 'check'} size={16} />
              </span>
            </TiltCard>
          ))}
        </Rail>
      </section>

      <section className="lp-section" aria-labelledby="lp-trending">
        <div className="lp-section-heading">
          <h2 id="lp-trending">
            <span className="lp-flame" aria-hidden="true">🔥</span> Trending now
          </h2>
          <small>Most booked right now. Spend your reward on one of these.</small>
        </div>
        {trending.length ? (
          <Rail label="Trending rentals">
            {trending.map((product, index) => {
              const price = priceOf(product)
              const saving = loyaltyRewardAmount(price)
              const inCart = cart.includes(product._id)
              const rewarded = rewardProductId === product._id
              return (
                <TiltCard key={product._id} role="listitem" className="lp-trend" style={{ animationDelay: `${index * 70}ms` }}>
                  <button type="button" className="lp-trend-media" onClick={() => openProductDetails(product)} aria-label={`View ${product.title}`}>
                    <RentalPhoto src={product.photos?.[0]} alt="" />
                    <span className="lp-trend-rank">#{index + 1}</span>
                    {Number(product.ratingCount) > 0 && (
                      <span className="lp-trend-rating">★ {Number(product.ratingAverage || 0).toFixed(1)}</span>
                    )}
                  </button>
                  <div className="lp-trend-body">
                    <small>{product.category}</small>
                    <h3>{product.title}</h3>
                    <div className="lp-trend-price">
                      {loyalty.rewardsAvailable > 0 ? (
                        <>
                          <b>{money(price - saving)}</b>
                          <s>{money(price)}</s>
                        </>
                      ) : (
                        <b>{money(price)}</b>
                      )}
                      <small>{billingUnit === 'hour' ? `/ ${hours || 1} h` : `/ ${days || 1} ${days === 1 ? 'day' : 'days'}`}</small>
                    </div>
                    <button
                      type="button"
                      className={`lp-trend-action${rewarded ? ' is-applied' : ''}`}
                      disabled={!product.available || loyalty.rewardsAvailable < 1 || rewarded}
                      onClick={() => redeem(product)}
                    >
                      {rewarded
                        ? 'Reward applied ✓'
                        : !product.available
                          ? 'Booked for your dates'
                          : loyalty.rewardsAvailable < 1
                            ? `Unlock at Level ${loyalty.level + 1}`
                            : `${inCart ? 'Apply' : 'Use'} ${loyalty.rewardPercent}% · save ${money(saving)}`}
                    </button>
                  </div>
                </TiltCard>
              )
            })}
          </Rail>
        ) : (
          <p className="lp-empty">
            No listings to show yet.{' '}
            <button type="button" className="lp-link" onClick={onBrowse}>
              Explore rentals
            </button>
          </p>
        )}
      </section>

      <section className="lp-section lp-how" aria-labelledby="lp-how">
        <h2 id="lp-how">How you earn</h2>
        <ol>
          <li>
            <span aria-hidden="true">1</span>
            <b>Rent an item</b>
            <small>Book anything on RentEase.</small>
          </li>
          <li>
            <span aria-hidden="true">2</span>
            <b>Return it</b>
            <small>Earn 1 point per LKR 1,000 of rent for each item (at least 1).</small>
          </li>
          <li>
            <span aria-hidden="true">3</span>
            <b>Level up</b>
            <small>
              Every {loyalty.pointsPerLevel} points unlocks {loyalty.rewardPercent}% off one product.
            </small>
          </li>
        </ol>
      </section>

      <section className="lp-section" aria-labelledby="lp-activity">
        <div className="lp-section-heading">
          <h2 id="lp-activity">Recent activity</h2>
        </div>
        {activity === null ? (
          <p className="lp-empty" role="status">
            Loading your activity…
          </p>
        ) : activity.length ? (
          <ul className="lp-activity">
            {activity.map((entry) => (
              <li key={`${entry.type}-${entry.rentalId}`} className={`is-${entry.type}`}>
                <span aria-hidden="true">
                  <UiIcon name={entry.type === 'earned' ? 'plus' : entry.type === 'redeemed' ? 'tag' : 'refresh'} size={16} />
                </span>
                <div>
                  <b>
                    {entry.type === 'earned'
                      ? `+${entry.points} ${entry.points === 1 ? 'point' : 'points'}`
                      : entry.type === 'redeemed'
                        ? `${entry.percent}% reward used · saved ${money(entry.amount)}`
                        : `${entry.percent}% reward returned to your wallet`}
                  </b>
                  <small>{entry.title}</small>
                </div>
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleDateString()}</time>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </section>
  )
}
