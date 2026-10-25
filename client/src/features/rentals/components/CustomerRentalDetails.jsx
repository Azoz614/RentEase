import DeliveryTaskBoard from '../../delivery-partner/components/DeliveryTaskBoard.jsx'
import { formatCurrency as money } from '../../../utils/currency.js'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import '../styles/customer-rental-details.css'
import { PickupSection, CancellationRecord } from './CustomerPickup.jsx'
import {
  customerRentalStatus,
  hasRentalPayment as paid,
  preferLatestRental,
  canCancelRental,
} from '../utils/customerRental.js'

const date = (value) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not recorded'
const idLabel = (id) => `RE-${String(id).slice(-8).toUpperCase()}`

function Icon({ name = 'box', size = 20 }) {
  const paths = {
    box: (
      <>
        <path d="m3 7 9-4 9 4v11l-9 4-9-4Z" />
        <path d="m3 7 9 4 9-4M12 11v11" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    receipt: (
      <>
        <path d="M5 3h14v18l-3-2-4 2-4-2-3 2Z" />
        <path d="M9 7h6M9 11h6M9 15h3" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.box}
    </svg>
  )
}

function duration(rental) {
  const elapsed = new Date(rental.endDate) - new Date(rental.startDate)
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 'Not recorded'
  const hourly = rental.items.some((item) => item.billingUnit === 'hour')
  const units = Math.ceil(elapsed / (hourly ? 3600000 : 86400000))
  return `${units} ${hourly ? (units === 1 ? 'hour' : 'hours') : units === 1 ? 'day' : 'days'}`
}

export default function CustomerRentalDetails({
  summary,
  api,
  onClose,
  onRentalUpdate,
  onAction,
  onInvoice,
  busy,
  onPickup,
  onReturn,
}) {
  const dialog = useRef(null)
  const headingId = useId()
  const mounted = useRef(false)
  const sequence = useRef(0)
  const [rental, setRental] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef(null)
  const summaryVersion = useRef(summary.updatedAt)
  const latestRental = useRef(null)
  const refresh = useCallback(
    async (signal) => {
      const version = ++sequence.current
      try {
        const result = await api(`/api/requests/${summary._id}`, { signal })
        if (!mounted.current || signal?.aborted || sequence.current !== version) return
        if (!result.rental || result.rental._id !== summary._id)
          throw new Error('This booking could not be loaded. Please try again.')
        const fresh = preferLatestRental(latestRental.current, result.rental)
        latestRental.current = fresh
        summaryVersion.current = fresh.updatedAt
        setRental(fresh)
        setError('')
        onRentalUpdate(fresh)
      } catch (failure) {
        if (
          failure.name !== 'AbortError' &&
          mounted.current &&
          !signal?.aborted &&
          sequence.current === version
        )
          setError(failure.message || 'We couldn’t load your booking. Please try again.')
      } finally {
        if (mounted.current && !signal?.aborted && sequence.current === version) setLoading(false)
      }
    },
    [api, summary._id, onRentalUpdate],
  )

  useLayoutEffect(() => {
    const element = dialog.current
    element.showModal()
    return () => {
      clearTimeout(closeTimer.current)
      element.close()
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    queueMicrotask(() => {
      if (!controller.signal.aborted) refresh(controller.signal)
    })
    let refreshing = false
    const poll = async () => {
      if (document.visibilityState === 'hidden' || refreshing) return
      refreshing = true
      try {
        await refresh(controller.signal)
      } finally {
        refreshing = false
      }
    }
    const timer = setInterval(poll, 20_000)
    window.addEventListener('focus', poll)
    document.addEventListener('visibilitychange', poll)
    return () => {
      mounted.current = false
      controller.abort()
      clearInterval(timer)
      window.removeEventListener('focus', poll)
      document.removeEventListener('visibilitychange', poll)
    }
  }, [refresh])
  // Payment/cancellation in the parent also refreshes an already-open details panel.
  useEffect(() => {
    if (summary.updatedAt === summaryVersion.current) return
    summaryVersion.current = summary.updatedAt
    queueMicrotask(() => {
      if (mounted.current && summary.updatedAt) refresh()
    })
  }, [summary.updatedAt, refresh])
  const dismiss = () => {
    if (busy || closing) return
    setClosing(true)
    closeTimer.current = setTimeout(onClose, 150)
  }
  const deposit = rental?.items.reduce((sum, item) => sum + Number(item.depositAmount || 0), 0) || 0
  return (
    <dialog
      ref={dialog}
      className={`cr-rental-dialog${closing ? ' is-closing' : ''}`}
      aria-labelledby={headingId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault()
        dismiss()
      }}
    >
      <header className="cr-detail-heading">
        <div>
          <span className="cr-eyebrow">YOUR RENTAL, IN DETAIL</span>
          <h2 id={headingId}>Booking {idLabel(summary._id)}</h2>
        </div>
        <button
          className="cr-dialog-close"
          aria-label="Close rental details"
          disabled={Boolean(busy)}
          onClick={dismiss}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="cr-detail-scroll">
        {loading && (
          <div className="cr-detail-loading" role="status">
            <span className="cr-skeleton">
              <i />
              <i />
              <i />
            </span>
            Loading your booking details…
          </div>
        )}
        {error && (
          <div className="cr-error" role="alert">
            <span>
              {error}
              {rental && ' Your last loaded details are still shown.'}
            </span>
            <button onClick={() => refresh()}>Try again</button>
          </div>
        )}
        {rental && (
          <>
            <div className="cr-detail-intro">
              <div>
                <span className={`cr-status cr-status-${rental.status}`}>
                  <i />
                  {customerRentalStatus(rental)}
                </span>
                <p>
                  {rental.items.length} {rental.items.length === 1 ? 'item' : 'items'} ·{' '}
                  {duration(rental)} ·{' '}
                  {rental.deliveryMethod === 'partner' ? 'Partner delivery' : 'In-person pickup'}
                </p>
              </div>
              <span className="cr-detail-secure">
                <Icon name="shield" size={16} />
                Email-verified handovers
              </span>
            </div>
            {rental.deliveryWorkflowVersion === 2 && <DeliveryTaskBoard api={api} role="user" rentalId={rental._id} onReturn={() => onReturn(rental)} />}
            <PickupSection rental={rental} onVerify={onPickup} busy={busy} />
            {rental.status === 'active' && !rental.returnVerifiedAt && (
              <section className="cr-pickup-section" aria-label="Customer return request">
                <span className="cr-eyebrow">RETURN YOUR RENTAL</span>
                <h3>
                  {rental.returnVerification?.status === 'pending'
                    ? 'Return request pending'
                    : 'Ready to return?'}
                </h3>
                <p>
                  {rental.deliveryWorkflowVersion === 2 && rental.deliveryMethod === 'partner'
                    ? 'Choose self return or ask a nearby rider to collect. Every handover is verified by email.'
                    : rental.returnVerification?.status === 'pending'
                      ? 'A return code was sent to your registered email. Give it to an administrator to complete the return.'
                      : 'Choose self return or delivery partner collection. For self return, verify the shop’s receipt code here.'}
                </p>
                <button
                  className="cr-button cr-primary"
                  disabled={
                    Boolean(busy) ||
                    Boolean(rental.deliveryReturnRequestedAt) ||
                    rental.returnVerification?.status === 'pending'
                  }
                  onClick={() => onReturn(rental)}
                >
                  {busy === `return-${rental._id}`
                    ? 'Sending code…'
                    : rental.returnVerification?.status === 'pending'
                      ? 'Return request pending'
                      : rental.deliveryWorkflowVersion === 2 && rental.deliveryMethod === 'partner'
                        ? rental.deliveryReturnRequestedAt
                          ? 'Collection requested'
                          : rental.returnMethod === 'pickup' ? 'Continue self return' : 'Return'
                        : rental.returnMethod === 'pickup' ? 'Continue self return' : 'Return'}
                </button>
              </section>
            )}
            <CancellationRecord rental={rental} />
            <LifecycleTimeline rental={rental} />
            <section className="cr-detail-section">
              <div className="cr-detail-section-title">
                <span className="cr-detail-section-icon">
                  <Icon />
                </span>
                <div>
                  <h3>Your rental items</h3>
                  <p>Booked item names and prices, with current catalog details.</p>
                </div>
              </div>
              <div className="cr-detail-products">
                {rental.items.map((item) => (
                  <ItemDetails key={String(item.productId?._id || item.productId)} item={item} />
                ))}
              </div>
            </section>
            <div className="cr-detail-columns">
              <section className="cr-detail-section">
                <div className="cr-detail-section-title">
                  <span className="cr-detail-section-icon">
                    <Icon name="clock" />
                  </span>
                  <h3>Booking information</h3>
                </div>
                <dl className="cr-information-list">
                  <Info label="Rental ID" value={rental._id} />
                  <Info label="Booked on" value={date(rental.createdAt)} />
                  <Info label="Rental starts" value={date(rental.startDate)} />
                  <Info label="Expected return" value={date(rental.endDate)} />
                  <Info label="Rental duration" value={duration(rental)} />
                  <Info
                    label="Actual pickup"
                    value={
                      rental.pickupVerifiedAt ? date(rental.pickupVerifiedAt) : 'Not verified yet'
                    }
                  />
                  <Info
                    label="Actual return"
                    value={
                      rental.returnVerifiedAt ? date(rental.returnVerifiedAt) : 'Not verified yet'
                    }
                  />
                  <Info label="Current stage" value={customerRentalStatus(rental)} />
                  {rental.delivery?.address && (
                    <Info label="Delivery address" value={rental.delivery.address} />
                  )}
                </dl>
              </section>
              <section className="cr-detail-section">
                <div className="cr-detail-section-title">
                  <span className="cr-detail-section-icon">
                    <Icon name="receipt" />
                  </span>
                  <h3>Payment details</h3>
                </div>
                <dl className="cr-information-list">
                  {rental.items.map((item) => (
                    <Info
                      key={String(item.productId)}
                      label={`${item.title} × ${item.quantity || 1}`}
                      value={money(item.rentalAmount)}
                    />
                  ))}
                  <Info label="Rental subtotal" value={money(rental.subtotal)} />
                  {Number(rental.discountAmount) > 0 && (
                    <Info
                      label={`Discount${rental.couponCode ? ` · ${rental.couponCode}` : ''}`}
                      value={`−${money(rental.discountAmount)}`}
                    />
                  )}
                  <Info label="Delivery fee" value={money(rental.deliveryFee)} />
                  <Info label="Rental total" value={money(rental.total)} />
                  <Info label="Refundable deposit" value={money(deposit)} />
                  <Info
                    label="Payment status"
                    value={
                      paid(rental)
                        ? 'Rental payment recorded'
                        : rental.payment?.status === 'failed'
                          ? 'Payment failed'
                          : 'Awaiting payment'
                    }
                  />
                  <Info label="Payment method" value={rental.payment?.method || 'Not recorded'} />
                  <Info label="Payment recorded at" value={date(rental.payment?.paidAt)} />
                  <Info label="Deposit held" value={money(rental.payment?.depositHeld)} />
                  {(rental.payment?.adjustments || []).map((adjustment, index) => (
                    <Info
                      key={index}
                      label={`${adjustment.type === 'late_fee' ? 'Late fee' : 'Damage fee'}${adjustment.note ? ` · ${adjustment.note}` : ''}`}
                      value={money(adjustment.amount)}
                    />
                  ))}
                  {rental.payment?.refundedAt && (
                    <Info
                      label="Deposit released"
                      value={`${money(rental.payment.depositRefunded)} · ${date(rental.payment.refundedAt)}`}
                    />
                  )}
                </dl>
                {rental.payment?.provider === 'sandbox' && paid(rental) && (
                  <p className="cr-detail-footnote">
                    Sandbox payment record. No real funds were charged.
                  </p>
                )}
              </section>
            </div>
            {rental.notifications?.length > 0 && (
              <section className="cr-detail-section">
                <h3>Updates for this booking</h3>
                {rental.notifications.map((notice) => (
                  <article className="cr-record" key={notice._id}>
                    <span>
                      <b>{notice.title}</b>
                      <p>{notice.body}</p>
                      <small>{date(notice.createdAt)}</small>
                    </span>
                  </article>
                ))}
              </section>
            )}
            <section className="cr-detail-verification">
              <span className="cr-detail-section-icon">
                <Icon name="shield" />
              </span>
              <div>
                <h3>Verified with you, at every handover.</h3>
                <p>
                  {rental.deliveryWorkflowVersion === 2 && rental.deliveryMethod === 'partner'
                    ? 'Shop staff verify the rider’s collection and final return codes. The rider verifies customer delivery and return collection codes.'
                    : 'Verify your pickup email code here, then authorized rental staff confirm physical handover. Return verification uses a separate email code.'}
                </p>
                <div>
                  <span>
                    Pickup:{' '}
                    <b>
                      {rental.pickupVerifiedAt
                        ? 'Handover confirmed'
                        : rental.pickupVerification?.status === 'customer_verified'
                          ? 'Email verified · handover pending'
                          : 'Pending verification'}
                    </b>
                  </span>
                  <span>
                    Return: <b>{rental.returnVerifiedAt ? 'Verified' : 'Pending verification'}</b>
                  </span>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
      <footer className="cr-detail-footer">
        <button className="cr-button cr-secondary" disabled={Boolean(busy)} onClick={dismiss}>
          Back to my rentals
        </button>
        <div>
          {rental?.invoiceNumber && (
            <button
              className="cr-button cr-secondary"
              disabled={Boolean(busy)}
              onClick={() => onInvoice(rental)}
            >
              Invoice PDF
            </button>
          )}
          {rental?.status === 'confirmed' &&
            rental.payment?.status === 'unpaid' &&
            rental.items.every((item) => item.decision === 'accepted') && (
              <button
                className="cr-button cr-primary"
                disabled={Boolean(busy)}
                onClick={() => onAction('pay', rental)}
              >
                Review payment
              </button>
            )}
          {rental && canCancelRental(rental) && (
            <button
              className="cr-text-button"
              disabled={Boolean(busy)}
              onClick={() => onAction('cancel', rental)}
            >
              Cancel booking
            </button>
          )}
        </div>
      </footer>
    </dialog>
  )
}

function Info({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

function ItemDetails({ item }) {
  const [index, setIndex] = useState(0)
  const photos = item.product?.photos || (item.image ? [item.image] : [])
  const active = Math.min(index, Math.max(0, photos.length - 1))
  return (
    <article className="cr-detail-product">
      <div className="cr-product-gallery">
        <div className="cr-product-main-image">
          <Icon size={44} />
          {photos[active] && (
            <img
              key={photos[active]}
              src={photos[active]}
              alt={`${item.title}, photo ${active + 1}`}
              onError={(event) => {
                event.currentTarget.hidden = true
              }}
            />
          )}
        </div>
        {photos.length > 1 && (
          <div className="cr-product-thumbnails" aria-label={`Photos of ${item.title}`}>
            {photos.map((photo, photoIndex) => (
              <button
                key={`${photo}-${photoIndex}`}
                aria-label={`Show ${item.title} photo ${photoIndex + 1}`}
                aria-pressed={active === photoIndex}
                onClick={() => setIndex(photoIndex)}
              >
                <img src={photo} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="cr-product-information">
        <span className="cr-eyebrow">
          {item.product?.category || item.category || 'RENTAL ITEM'}
        </span>
        <h4>{item.title}</h4>
        <p>
          {item.product?.description ||
            'Additional product details are no longer available. Your booked item and price are preserved.'}
        </p>
        <div className="cr-item-facts">
          <span>
            Quantity <b>{item.quantity || 1}</b>
          </span>
          <span>
            Rental amount <b>{money(item.rentalAmount)}</b>
          </span>
          <span>
            Booking decision <b>{item.decision || 'pending'}</b>
          </span>
        </div>
        {item.product?.specifications?.length > 0 && (
          <dl className="cr-product-specifications">
            {item.product.specifications.map((specification, specIndex) => (
              <Info
                key={`${specification.name}-${specIndex}`}
                label={specification.name}
                value={specification.value}
              />
            ))}
          </dl>
        )}
      </div>
    </article>
  )
}

export function LifecycleTimeline({ rental }) {
  const confirmed = rental.statusHistory?.find((event) => event.status === 'confirmed')
  const returned = rental.statusHistory?.find((event) => event.status === 'returned')
  const isReturned = ['returned', 'completed'].includes(rental.status)
  const booked = Boolean(
    confirmed ||
    rental.pickupVerifiedAt ||
    ['confirmed', 'active', 'returned', 'completed'].includes(rental.status),
  )
  const steps = [
    ['Booked', booked, confirmed?.at || (booked ? rental.createdAt : null)],
    [
      'Pickup verified',
      Boolean(rental.pickupVerification?.customerVerifiedAt || rental.pickupVerifiedAt),
      rental.pickupVerification?.customerVerifiedAt || rental.pickupVerifiedAt,
    ],
    [
      'On rental',
      Boolean(rental.pickupVerifiedAt) || rental.status === 'active',
      rental.pickupVerifiedAt,
    ],
    [
      'Return verified',
      Boolean(rental.returnOtpVerifiedAt || rental.returnVerifiedAt),
      rental.returnOtpVerifiedAt || rental.returnVerifiedAt,
    ],
    ['Returned', isReturned, rental.returnVerifiedAt || returned?.at],
  ]
  const current =
    rental.status === 'confirmed' ? 0 : rental.status === 'active' ? 2 : rental.status === 'return_in_transit' ? 3 : isReturned ? 4 : -1
  return (
    <ol className="cr-lifecycle-timeline" aria-label="Detailed rental lifecycle">
      {steps.map(([label, complete, timestamp], index) => (
        <li
          key={label}
          className={`${complete ? 'is-complete' : ''}${index === current ? ' is-current' : ''}`}
          aria-current={index === current ? 'step' : undefined}
        >
          <span>
            <Icon name={complete && index !== current ? 'check' : 'clock'} size={15} />
          </span>
          <b>{label}</b>
          <small>{timestamp ? date(timestamp) : complete ? 'Time not recorded' : 'Pending'}</small>
        </li>
      ))}
    </ol>
  )
}
