import { formatCurrency as money } from '../../../utils/currency.js'
import { useId } from 'react'
import { PickupSection, CancellationRecord } from './CustomerPickup.jsx'
import { customerRentalStatus, canCancelRental } from '../utils/customerRental.js'

import {
  shortId,
  formatDate,
  hasPayment,
  depositFor,
  canPay,
  maskEmail,
  nextStep,
} from '../utils/customerRentalPresentation.js'

import { Symbol } from './Symbol.jsx'

import { RentalProgress } from './RentalProgress.jsx'

export function RentalCard({
  rental,
  products,
  email,
  busy,
  onAction,
  onInvoice,
  onMessages,
  onViewDetails,
  onPickup,
  onReturn,
  onAssign,
}) {
  const state = rental.status || 'pending'
  const step = nextStep(rental)
  const titleId = useId()
  const paid = hasPayment(rental)
  const isHour = rental.items.some((item) => item.billingUnit === 'hour')
  const deposit = depositFor(rental)
  const adjustments = rental.payment?.adjustments || []
  const adjustmentTotal = adjustments.reduce(
    (sum, adjustment) => sum + Number(adjustment.amount || 0),
    0,
  )
  const depositReleased = Boolean(rental.payment?.refundedAt)
  const cover =
    rental.items[0]?.image ||
    products.find(
      (product) =>
        product._id === String(rental.items[0]?.productId?._id || rental.items[0]?.productId),
    )?.photos?.[0]
  const openCard = (event) => {
    if (
      event.target.closest('button, a, input, select, summary, details, textarea') ||
      window.getSelection()?.toString()
    )
      return
    event.currentTarget.focus({ preventScroll: true })
    onViewDetails(rental, event.currentTarget)
  }
  return (
    <article
      className={`cr-rental-card cr-state-${state}`}
      aria-labelledby={titleId}
      tabIndex={0}
      onClick={openCard}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
          event.preventDefault()
          onViewDetails(rental, event.currentTarget)
        }
      }}
    >
      <div className="cr-card-cover">
        <Symbol name="box" size={46} />
        {cover && (
          <img
            src={cover}
            alt={rental.items[0]?.title || 'Rental item'}
            loading="lazy"
            onError={(event) => {
              event.currentTarget.hidden = true
            }}
          />
        )}
        <span>
          {rental.items.length} {rental.items.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      <header className="cr-card-header">
        <span className="cr-booking-id">
          <Symbol name="receipt" size={15} />
          {shortId(rental._id)}
          <small>Requested {formatDate(rental.createdAt)}</small>
        </span>
        <span className={`cr-status cr-status-${state}`}>
          <i />
          {customerRentalStatus(rental)}
        </span>
      </header>
      <div className="cr-card-layout">
        <div className="cr-card-main">
          <div className="cr-items">
            {rental.items.map((item, index) => {
              const product = products.find(
                (entry) => entry._id === String(item.productId?._id || item.productId),
              )
              return (
                <div className="cr-item" key={String(item.productId?._id || item.productId)}>
                  <div className="cr-item-thumb">
                    <Symbol name="box" size={26} />
                    {(item.image || product?.photos?.[0]) && (
                      <img
                        src={item.image || product.photos[0]}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.hidden = true
                        }}
                      />
                    )}
                  </div>
                  <div>
                    {index === 0 ? <h2 id={titleId}>{item.title}</h2> : <h3>{item.title}</h3>}
                    <p>
                      {item.category || product?.category || 'Rental item'}
                      <span>·</span>
                      {item.decision === 'accepted'
                        ? 'Item accepted'
                        : item.decision === 'rejected'
                          ? 'Item declined'
                          : 'Awaiting approval'}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="cr-dates">
            <div>
              <Symbol name="calendar" size={18} />
              <span>
                <small>Rental starts</small>
                <b>{formatDate(rental.startDate, isHour)}</b>
              </span>
            </div>
            <span className="cr-date-arrow">
              <Symbol name="arrow" size={16} />
            </span>
            <div>
              <Symbol name="calendar" size={18} />
              <span>
                <small>Return by</small>
                <b>{formatDate(rental.endDate, isHour)}</b>
              </span>
            </div>
          </div>
          <RentalProgress rental={rental} />
          <PickupSection rental={rental} onVerify={onPickup} busy={busy} />
          <CancellationRecord rental={rental} />
          <button
            className="cr-button cr-primary cr-view-details"
            onClick={(event) => onViewDetails(rental, event.currentTarget)}
            aria-label={`View details for ${shortId(rental._id)}`}
          >
            View details
            <Symbol name="arrow" size={16} />
          </button>
          <div className="cr-fulfilment">
            <Symbol name={rental.deliveryMethod === 'partner' ? 'truck' : 'box'} size={17} />
            <span>
              {rental.deliveryMethod === 'partner'
                ? 'Partner delivery & collection'
                : 'Collect and return in person'}
            </span>
            {rental.deliveryMethod === 'partner' &&
              rental.items.some((item) => item.partnerAssigned || item.assignedPartner) && (
                <small>Partner assigned</small>
              )}
          </div>
        </div>
        <aside
          className={`cr-next-step cr-tone-${step.tone}`}
          aria-label={`Next step for ${shortId(rental._id)}`}
        >
          <span className="cr-next-icon">
            <Symbol name={step.icon} size={22} />
          </span>
          <span className="cr-eyebrow">
            {['returned', 'completed', 'cancelled'].includes(state)
              ? 'BOOKING UPDATE'
              : 'WHAT HAPPENS NEXT'}
          </span>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
          {['confirmed', 'active'].includes(state) && !canPay(rental) && (
            <div className="cr-email-destination">
              <Symbol name="mail" size={15} />
              {maskEmail(email)}
            </div>
          )}
          {canPay(rental) && (
            <button
              className="cr-button cr-primary"
              disabled={Boolean(busy)}
              onClick={() => onAction('pay', rental)}
            >
              Review payment
              <Symbol name="arrow" size={16} />
            </button>
          )}
          {state === 'disputed' && (
            <button className="cr-button cr-secondary" onClick={onMessages}>
              View mailbox
              <Symbol name="mail" size={16} />
            </button>
          )}
        </aside>
      </div>
      <div className="cr-card-footer">
        <div className="cr-costs">
          <div>
            <small>Rental total</small>
            <b>{money(rental.total)}</b>
            <span>{paid ? 'Payment recorded' : 'Including any booked delivery fee'}</span>
          </div>
          <span className="cr-cost-divider" />
          <div>
            <small>Security deposit</small>
            <b>{money(deposit)}</b>
            <span>
              {depositReleased
                ? `${money(rental.payment.depositRefunded)} released`
                : paid && Number(rental.payment?.depositHeld) > 0
                  ? 'Held until return inspection'
                  : 'Refundable · separate from rental'}
            </span>
          </div>
        </div>
        <div className="cr-booking-actions">
          {state === 'confirmed' && rental.deliveryMethod === 'partner' && (
            <button className="cr-button cr-primary" disabled={Boolean(busy)}
              onClick={() => rental.deliveryAssignmentRequestedAt ? onViewDetails(rental) : onAssign(rental)}>
              <Symbol name="box" size={17} />
              {busy === `assign-${rental._id}` ? 'Finding riders…' : rental.deliveryAssignmentRequestedAt ? 'Track delivery' : 'Assign Delivery Partner'}
            </button>
          )}
          {rental.status === 'active' && !rental.returnVerifiedAt && (
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
          )}
          {rental.invoiceNumber && (
            <button
              className="cr-button cr-secondary"
              disabled={Boolean(busy)}
              onClick={() => onInvoice(rental)}
            >
              <Symbol name="receipt" size={16} />
              {busy === `invoice-${rental._id}` ? 'Downloading…' : 'Invoice PDF'}
            </button>
          )}
          {canCancelRental(rental) && (
            <button
              className="cr-text-button"
              disabled={Boolean(busy)}
              onClick={() => onAction('cancel', rental)}
            >
              Cancel booking
            </button>
          )}
        </div>
      </div>
      <details className="cr-details">
        <summary>
          Booking & payment details
          <Symbol name="chevron" size={17} />
        </summary>
        <div className="cr-detail-content">
          <section>
            <h3>Payment breakdown</h3>
            <dl>
              <div>
                <dt>Rental subtotal</dt>
                <dd>{money(rental.subtotal)}</dd>
              </div>
              {Number(rental.discountAmount) > 0 && (
                <div>
                  <dt>Discount{rental.couponCode ? ` · ${rental.couponCode}` : ''}</dt>
                  <dd>−{money(rental.discountAmount)}</dd>
                </div>
              )}
              <div>
                <dt>Delivery fee</dt>
                <dd>{money(rental.deliveryFee)}</dd>
              </div>
              <div>
                <dt>Rental total</dt>
                <dd>{money(rental.total)}</dd>
              </div>
              <div>
                <dt>Deposit held</dt>
                <dd>{money(rental.payment?.depositHeld)}</dd>
              </div>
              {adjustments.map((adjustment, index) => (
                <div key={adjustment._id || index}>
                  <dt>
                    {adjustment.type === 'late_fee' ? 'Late fee' : 'Damage fee'}
                    <small>{adjustment.note}</small>
                  </dt>
                  <dd>{money(adjustment.amount)}</dd>
                </div>
              ))}
              {depositReleased && (
                <div>
                  <dt>Deposit released</dt>
                  <dd>{money(rental.payment.depositRefunded)}</dd>
                </div>
              )}
            </dl>
            {adjustmentTotal > 0 && <p>Recorded fees are deducted from the held deposit.</p>}
            {rental.payment?.provider === 'sandbox' && paid && (
              <p>Sandbox payment record. No real funds were charged.</p>
            )}
          </section>
          <section>
            <h3>Your handover record</h3>
            <div className="cr-record">
              <Symbol name="shield" size={17} />
              <span>
                <b>Pickup verification</b>
                <small>
                  {rental.pickupVerifiedAt
                    ? formatDate(rental.pickupVerifiedAt, true)
                    : 'No verified pickup recorded yet'}
                </small>
              </span>
            </div>
            <div className="cr-record">
              <Symbol name="shield" size={17} />
              <span>
                <b>Return verification</b>
                <small>
                  {rental.returnVerifiedAt
                    ? formatDate(rental.returnVerifiedAt, true)
                    : 'No verified return recorded yet'}
                </small>
              </span>
            </div>
            {rental.deliveryMethod === 'partner' && (
              <div className="cr-delivery-record">
                {rental.items.map((item) => (
                  <p key={String(item.productId?._id || item.productId)}>
                    <b>{item.title}</b> · {(item.deliveryStatus || 'assigned').replaceAll('_', ' ')}
                    {item.assignedPartner?.username ? ` · ${item.assignedPartner.username}` : ''}
                  </p>
                ))}
              </div>
            )}
            <button className="cr-text-button" onClick={onMessages}>
              Check your mailbox <Symbol name="arrow" size={14} />
            </button>
          </section>
        </div>
      </details>
    </article>
  )
}
