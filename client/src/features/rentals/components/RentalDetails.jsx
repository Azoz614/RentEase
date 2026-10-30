import { formatCurrency as money } from '../../../utils/currency.js'
import { useEffect, useState } from 'react'
import { preferLatestRental } from '../utils/customerRental.js'

import { labels, date, shortId } from '../utils/handoverPresentation.js'

import { Glyph } from './Glyph.jsx'
import { Status } from './Status.jsx'
import { RentalAction } from './RentalAction.jsx'
import { useModalDismiss } from '../hooks/useModalDismiss.js'
import { Modal } from './Modal.jsx'
import DeliveryTaskBoard from '../../delivery-partner/components/DeliveryTaskBoard.jsx'
import { RentalJobSummary, RentalJobCodes } from './RentalJobSummary.jsx'
import { DepositSettlement } from './DepositSettlement.jsx'

export function RentalDetails({ rental: initial, request, onClose: onDismiss, onVerify }) {
  const [onClose, closing] = useModalDismiss(onDismiss)
  const [rental, setRental] = useState(initial)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    request(`/rentals/${initial._id}`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted)
          setRental((current) => preferLatestRental(current, result.rental))
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message)
      })
    return () => controller.abort()
  }, [initial, request])
  const reload = async () => {
    const result = await request(`/rentals/${initial._id}`)
    setRental((current) => preferLatestRental(current, result.rental))
  }
  const updates = rental.notifications?.filter((n) => n.type !== 'handover_otp' && !n.expiresAt) || []
  const confirmation = rental.statusHistory?.find((event) => event.status === 'confirmed')
  const booked = Boolean(
    confirmation ||
    rental.pickupVerifiedAt ||
    ['confirmed', 'active', 'returned', 'completed'].includes(rental.status),
  )
  const steps = [
    ['Booked', booked ? confirmation?.at || rental.createdAt : null, booked],
    ['Picked up', rental.pickupVerifiedAt, Boolean(rental.pickupVerifiedAt)],
    ['On rental', rental.pickupVerifiedAt, Boolean(rental.pickupVerifiedAt)],
    ['Returned', rental.returnVerifiedAt, Boolean(rental.returnVerifiedAt)],
  ]
  return (
    <Modal
      titleId="rental-details-title"
      closing={closing}
      onClose={onClose}
      className="handover-details"
    >
      <header className="handover-modal-heading">
        <div>
          <span className="handover-eyebrow">RENTAL DETAILS</span>
          <h2 id="rental-details-title">{shortId(rental._id)}</h2>
        </div>
        <button
          className="handover-icon-button"
          aria-label="Close rental details"
          onClick={onClose}
        >
          <Glyph name="close" />
        </button>
      </header>
      <RentalJobSummary rental={rental} status={<Status value={rental.status} workflow={rental.pickupVerification} />} />
      <RentalJobCodes notifications={rental.notifications} />
      <section className="rental-job-next" aria-label="Next shop action">
        <span className="rental-job-next-icon"><Glyph name="shield" /></span>
        <div><span className="rental-job-kicker">NEXT STEP</span><h3>{rental.status === 'confirmed' ? 'Prepare your handover' : rental.status === 'active' ? 'Your customer has the items' : rental.status === 'return_in_transit' ? 'The rider is bringing the return' : 'Your rental record'}</h3>
          <p>{rental.deliveryMethod === 'partner' || rental.returnMethod === 'partner' ? 'Follow the shipment below for the next person and verification action.' : 'Each receipt is confirmed with a private code sent to the recipient.'}</p></div>
        <RentalAction rental={rental} onVerify={onVerify} />
      </section>
      {error && (
        <p role="alert" className="handover-feedback error">
          {error}
        </p>
      )}
      <ol className="handover-progress">
        {steps.map(([label, timestamp, done]) => (
          <li className={done ? 'complete' : ''} key={label}>
            <span>
              <Glyph name={done ? 'check' : 'clock'} width="14" height="14" />
            </span>
            <b>{label}</b>
            <small>{timestamp ? date(timestamp) : 'Pending'}</small>
          </li>
        ))}
      </ol>
      <div className="handover-details-grid">
        <section>
          <h3>Customer</h3>
          <b>{rental.customerId?.username || 'Unavailable'}</b>
          <p>
            {rental.customerId?.maskedEmail || 'No email'}
            <br />
            {rental.customerId?.phone}
          </p>
        </section>
        <section>
          <h3>Rental period</h3>
          <p>
            {date(rental.startDate)}
            <br />
            to {date(rental.endDate)}
          </p>
        </section>
      </div>
      {rental.deliveryWorkflowVersion === 2 && <DeliveryTaskBoard api={request} role="rental_shop" rentalId={rental._id} />}
      {updates.length > 0 && <section className="handover-history"><h3>Your private job updates</h3>
        {updates.map((n) => <article key={n._id}><b>{n.title}</b><p>{n.body}</p><small>{date(n.createdAt)}</small></article>)}
      </section>}
      <section className="handover-detail-items">
        <h3>Rented items</h3>
        {rental.items.map((item) => (
          <div key={item.productId}>
            {item.image && <img className="handover-item-photo" src={item.image} alt={item.title} />}
            <span>
              {item.title}
              <small>{item.decision}</small>
            </span>
            <b>{money(item.rentalAmount)}</b>
          </div>
        ))}
      </section>
      <DepositSettlement rental={rental} request={request} onUpdated={reload} />
      <div className="handover-details-grid handover-verifier">
        <section>
          <h3>Pickup verified</h3>
          <b>{rental.pickupVerifiedBy?.username || 'Pending'}</b>
          <p>{date(rental.pickupVerifiedAt)}</p>
        </section>
        <section>
          <h3>Return verified</h3>
          <b>{rental.returnVerifiedBy?.username || 'Pending'}</b>
          <p>{date(rental.returnVerifiedAt)}</p>
        </section>
      </div>
      <section className="handover-history">
        <h3>Activity history</h3>
        {rental.statusHistory?.length ? (
          <ol>
            {rental.statusHistory.map((event) => (
              <li key={event._id || `${event.at}-${event.status}`}>
                <i />
                <div>
                  <b>{labels[event.status] || event.status}</b>
                  <p>{event.note}</p>
                  <small>
                    {date(event.at)} · {event.by?.username || 'System'}
                    {event.verificationId && ' · Email verified'}
                  </small>
                  {event.senderId && <small>Sender: {event.senderId.username || event.senderId} · Recipient: {event.recipientId?.username || event.recipientId} · Verifier: {event.by?.username || 'Recorded'}</small>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p>No historical events were recorded for this rental.</p>
        )}
      </section>
      <footer className="handover-modal-actions">
        <button className="handover-button secondary" onClick={onClose}>
          Close details
        </button>
      </footer>
    </Modal>
  )
}
