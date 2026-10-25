import { labels } from '../utils/handoverPresentation.js'

export function Status({ value, workflow }) {
  return (
    <>
      <span className={`handover-status status-${value || 'pending'}`}>
        <i />
        {labels[value] || 'Pending approval'}
      </span>
      {value === 'confirmed' && (
        <small className="handover-pickup-progress">
          {workflow?.status === 'customer_verified'
            ? 'Customer email verified · ready for handover'
            : workflow?.status === 'pending'
              ? 'Customer OTP verification pending'
              : 'Customer email not yet verified'}
        </small>
      )}
    </>
  )
}
