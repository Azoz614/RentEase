import { useRef, useState } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { authPost, passwordError } from '../services/auth.js'
import { OtpVerification } from './OtpVerification.jsx'
import { PasswordFields } from './PasswordFields.jsx'

export default function ForgotPassword({ onLogin, onComplete, onResetReady }) {
  const [step, setStep] = useState(1), [email, setEmail] = useState('')
  const [challenge, setChallenge] = useState(null), [resetToken, setResetToken] = useState('')
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [retryAt, setRetryAt] = useState(0), inFlight = useRef(false)
  const send = async () => {
    const normalized = email.trim().toLowerCase()
    const result = await authPost('forgot-password', { email: normalized })
    setEmail(normalized); setChallenge(result)
    return result
  }
  const start = async (event) => {
    event.preventDefault()
    if (inFlight.current) return
    if (Date.now() < retryAt) { setMessage(`Please wait ${Math.ceil((retryAt - Date.now()) / 1000)} seconds before requesting another code.`); return }
    inFlight.current = true; setBusy(true); setMessage('')
    try { await send(); setStep(2) }
    catch (failure) { setMessage(failure.message); if (failure.retryAfter) setRetryAt(Date.now() + failure.retryAfter * 1000) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const reset = async (event) => {
    event.preventDefault()
    if (inFlight.current) return
    const form = event.currentTarget, data = new FormData(form)
    const password = data.get('password'), confirmPassword = data.get('confirmPassword')
    const validation = passwordError(password, confirmPassword)
    if (validation) { setMessage(validation); return }
    inFlight.current = true; setBusy(true); setMessage('')
    try {
      const result = await authPost('reset-password', { email, resetToken, password, confirmPassword })
      setResetToken(''); form.reset(); onComplete({ email, message: result.message })
    } catch (failure) { setMessage(failure.message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div className="login-panel"><div className="login-form-content">
    <div className="login-heading">
      <span className="login-step">Step {step} of 3</span>
      <h2>{step === 1 ? 'Reset your password' : step === 2 ? 'Check your email' : 'Set a new password'}</h2>
      {step === 1 && <p>Enter your email and we’ll send you a 6-digit code.</p>}
      {step === 2 && <p>If an account exists for <strong>{email}</strong>, you’ll receive a 6-digit code.</p>}
    </div>
    <div className="re-registration-progress" aria-hidden="true">
      {[1, 2, 3].map((number) => <span key={number} className={number <= step ? 'is-complete' : ''} />)}
    </div>
    {step === 1 && <form className="login-form" onSubmit={start} aria-busy={busy}>
      <label htmlFor="recovery-email">Email</label>
      <div className="login-input-wrap">
        <input id="recovery-email" type="email" autoComplete="email" placeholder="you@example.com" maxLength={254} value={email} required disabled={busy} onChange={(event) => { setEmail(event.target.value); setMessage('') }} autoFocus />
      </div>
      {message && <p className="auth-inline-error" role="alert">{message}</p>}
      <button className="login-submit" disabled={busy}>{busy && <span className="register-spinner" aria-hidden="true" />}{busy ? 'Sending code…' : 'Send reset code'}</button>
    </form>}
    {step === 2 && <OtpVerification email={email} challenge={challenge}
      onVerify={(otp) => authPost('forgot-password/verify-otp', { email, otp })}
      onVerified={(result) => { setResetToken(result.resetToken); setStep(3); setMessage(''); onResetReady?.() }}
      onResend={send} onBack={() => { setResetToken(''); setMessage(''); setStep(1) }} />}
    {step === 3 && <form className="login-form" onSubmit={reset} aria-busy={busy} onChange={() => setMessage('')}>
      <div className="auth-verified-email"><UiIcon name="check" size={16} />{email}</div>
      <PasswordFields disabled={busy} error={message} passwordLabel="New password" />
      {message && <p className="auth-inline-error" role="alert">{message}</p>}
      <button className="login-submit" disabled={busy}>{busy && <span className="register-spinner" aria-hidden="true" />}{busy ? 'Saving…' : 'Reset password'}</button>
      <button type="button" className="register-back" disabled={busy} onClick={() => { setResetToken(''); setStep(2); setMessage('') }}>Request a new code</button>
    </form>}
    {message && step === 2 && <p className="auth-inline-error" role="alert">{message}</p>}
    <p className="login-switch-copy"><a href="/login" onClick={onLogin}>← Back to sign in</a></p>
  </div></div>
}
