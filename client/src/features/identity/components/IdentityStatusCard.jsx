import { UiIcon } from '../../../components/ui/UiIcon.jsx'

export function IdentityStatusCard({ identity, onOpen, onAddresses, hideAction = false }) {
  const status = identity?.status || 'not_submitted'
  const titles = {
    not_submitted: 'Complete your identity verification to start renting.',
    pending: 'Your identity verification is under review.',
    approved: 'Identity Verified',
    rejected: 'Verification requires attention.',
    resubmission_required: 'Additional information is required.',
  }
  return (
    <section
      className={`iv-status-card iv-status-${status}`}
      aria-label="Identity verification status"
    >
      <span className="iv-status-emblem" aria-hidden="true">
        <UiIcon
          name={status === 'approved' ? 'shield' : status === 'pending' ? 'clock' : 'user'}
          size={25}
        />
      </span>
      <div>
        <h2>{titles[status]}</h2>
        <p>
          {status === 'approved'
            ? 'Your NIC is approved. Keep your address book up to date before requesting items.'
            : status === 'pending' ? 'You can keep browsing Explore while an administrator reviews your NIC. Rental requests open after approval.'
            : identity?.reviewNote ||
              'Your full legal name, NIC photos and residential address need administrator approval before rental requests.'}
        </p>
        {identity?.maskedNic && <small>{identity.maskedNic}</small>}
      </div>
      <div className="iv-status-actions">
        {!hideAction && (
          <button className="iv-button" onClick={onOpen}>
            {status === 'approved'
              ? 'View verification'
              : status === 'pending'
                ? 'View progress'
                : ['rejected', 'resubmission_required'].includes(status)
                  ? 'Review feedback'
                  : 'Verify NIC'}
          </button>
        )}
        {onAddresses && (
          <button className="iv-button secondary" onClick={onAddresses}>
            Address book
          </button>
        )}
      </div>
    </section>
  )
}
