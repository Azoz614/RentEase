import { useId, useState } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'

export function PasswordToggle({ visible, onToggle, label = 'password' }) {
  return <button type="button" className="login-password-toggle" aria-label={visible ? `Hide ${label}` : `Show ${label}`}
    aria-pressed={visible} onClick={onToggle}><UiIcon name={visible ? 'eyeOff' : 'eye'} size={18} /></button>
}

export function PasswordFields({ disabled, error, passwordLabel = 'Password' }) {
  const [visible, setVisible] = useState(false), id = useId()
  return <>
    <label htmlFor={`${id}-password`}>{passwordLabel}</label>
    <div className="login-input-wrap">
      <input id={`${id}-password`} name="password" type={visible ? 'text' : 'password'}
        autoComplete="new-password" minLength={10} maxLength={128} required disabled={disabled}
        aria-describedby={`${id}-policy`} />
      <PasswordToggle visible={visible} label="passwords" onToggle={() => setVisible((current) => !current)} />
    </div>
    <small id={`${id}-policy`} className="auth-field-hint">At least 10 characters.</small>
    <label htmlFor={`${id}-confirmation`}>Confirm password</label>
    <div className="login-input-wrap">
      <input id={`${id}-confirmation`} name="confirmPassword" type={visible ? 'text' : 'password'}
        autoComplete="new-password" minLength={10} maxLength={128} required disabled={disabled}
        aria-invalid={Boolean(error)} />
    </div>
  </>
}
