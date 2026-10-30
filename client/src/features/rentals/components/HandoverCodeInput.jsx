import { OtpInput } from '../../../components/ui/OtpInput.jsx'
import '../styles/handover-code.css'

export function HandoverCodeInput({ name = 'code', disabled, 'aria-label': label = 'Handover code' }) {
  return <OtpInput name={name} disabled={disabled} label={label} className="rental-code-input" />
}
