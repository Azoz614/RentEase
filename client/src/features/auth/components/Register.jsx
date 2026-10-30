import { useRef, useState } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { authPost, passwordError, readRegistration, saveRegistration } from '../services/auth.js'
import { PasswordFields } from './PasswordFields.jsx'
import { OtpVerification } from './OtpVerification.jsx'

const emptyDetails = { name: '', email: '', phone: '', accountType: 'user', shopName: '' }

export default function Register({ onLogin, onComplete }) {
  const [saved] = useState(readRegistration)
  const [step, setStep] = useState(saved?.registrationToken ? 3 : saved ? 2 : 1)
  const [details, setDetails] = useState(saved?.details || emptyDetails)
  const [challenge, setChallenge] = useState(saved?.challenge || null)
  const [registrationToken, setRegistrationToken] = useState(saved?.registrationToken || '')
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const inFlight = useRef(false)
  const update = (event) => { setDetails((current) => ({ ...current, [event.target.name]: event.target.value })); setMessage('') }
  const send = async () => {
    const normalized = { ...details, name: details.name.trim(), email: details.email.trim().toLowerCase(), phone: details.phone.trim() }
    if (normalized.phone.length < 7 || !/^[+\d().\s-]+$/.test(normalized.phone))
      throw new Error('Enter a valid contact phone number.')
    const result = await authPost('register/send-otp', {
      username: normalized.name, email: normalized.email, phone: normalized.phone,
      accountType: normalized.accountType, shopName: normalized.shopName,
    })
    setDetails(normalized); setChallenge(result); setRegistrationToken('')
    saveRegistration({ details: normalized, challenge: result, expiresAt: result.expiresAt })
    return result
  }
  const next = async (event) => {
    event.preventDefault()
    if (inFlight.current) return
    if (Date.now() < retryAt) { setMessage(`Please wait ${Math.ceil((retryAt - Date.now()) / 1000)} seconds before requesting another code.`); return }
    inFlight.current = true; setBusy(true); setMessage('')
    try { await send(); setStep(2) }
    catch (error) { setMessage(error.message); if (error.retryAfter) setRetryAt(Date.now() + error.retryAfter * 1000) }
    finally { inFlight.current = false; setBusy(false) }
  }
  const complete = async (event) => {
    event.preventDefault()
    if (inFlight.current) return
    const form = event.currentTarget, data = new FormData(form)
    const password = data.get('password'), confirmPassword = data.get('confirmPassword')
    const validation = passwordError(password, confirmPassword)
    if (validation) { setMessage(validation); return }
    inFlight.current = true; setBusy(true); setMessage('')
    try {
      const result = await authPost('register/complete', { email: details.email, password, confirmPassword, registrationToken })
      form.reset(); saveRegistration(null)
      onComplete({ email: details.email, message: result.message })
    } catch (error) { setMessage(error.message) }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <div className="login-panel"><div className="login-form-content">
    <div className="login-heading">
      <span className="login-step">Step {step} of 3</span>
      <h2>{step === 1 ? 'Create your account' : step === 2 ? 'Check your email' : 'Set your password'}</h2>
      {step === 2 && <p>Enter the 6-digit code we sent to <strong>{details.email}</strong>.</p>}
    </div>
    <div className="re-registration-progress" aria-hidden="true">
      {[1, 2, 3].map((number) => <span key={number} className={number <= step ? 'is-complete' : ''} />)}
    </div>
    {step === 1 && <form className="login-form" onSubmit={next} aria-busy={busy}>
      <fieldset className="auth-account-type" disabled={busy}>
        <legend>I want to</legend>
        {[['user', 'Rent items', 'user'], ['rental_shop', 'List my shop', 'store']].map(([value, title, icon]) =>
          <label key={value} className={details.accountType === value ? 'is-selected' : ''}>
            <input type="radio" name="accountType" value={value} checked={details.accountType === value} onChange={update} />
            <UiIcon name={icon} size={20} /><span>{title}</span>
          </label>)}
      </fieldset>
      <label htmlFor="register-name">Username</label>
      <div className="login-input-wrap">
        <input id="register-name" name="name" autoComplete="username" value={details.name} onChange={update} minLength={2} maxLength={50} required disabled={busy} />
      </div>
      <label htmlFor="register-email">Email</label>
      <div className="login-input-wrap">
        <input id="register-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" value={details.email} onChange={update} maxLength={254} required disabled={busy} />
      </div>
      <label htmlFor="register-phone">Phone number</label>
      <div className="login-input-wrap">
        <input id="register-phone" name="phone" type="tel" autoComplete="tel" placeholder="07X XXX XXXX" value={details.phone} onChange={update} minLength={7} maxLength={24} required disabled={busy} />
      </div>
      {details.accountType === 'rental_shop' && <>
        <label htmlFor="register-shop-name">Shop name</label>
        <div className="login-input-wrap">
          <input id="register-shop-name" name="shopName" value={details.shopName} onChange={update} maxLength={100} required disabled={busy} aria-describedby="register-shop-hint" />
        </div><small id="register-shop-hint" className="auth-field-hint">Shop accounts are reviewed by our team before you can sign in.</small>
      </>}
      {message && <p className="auth-inline-error" role="alert">{message}</p>}
      <button className="login-submit" disabled={busy}>{busy && <span className="register-spinner" aria-hidden="true" />}{busy ? 'Sending code…' : 'Continue'}</button>
    </form>}
    {step === 2 && <OtpVerification email={details.email} challenge={challenge}
      onVerify={(otp) => authPost('register/verify-otp', { email: details.email, otp })}
      onVerified={(result) => {
        setRegistrationToken(result.registrationToken)
        saveRegistration({ details, challenge, registrationToken: result.registrationToken, expiresAt: result.expiresAt })
        setMessage(''); setStep(3)
      }} onResend={send} onBack={() => { saveRegistration(null); setStep(1); setMessage('') }} />}
    {step === 3 && <form className="login-form" onSubmit={complete} aria-busy={busy} onChange={() => setMessage('')}>
      <div className="auth-verified-email"><UiIcon name="check" size={16} />{details.email}</div>
      <PasswordFields disabled={busy} error={message} />
      {message && <p className="auth-inline-error" role="alert">{message}</p>}
      <button className="login-submit" disabled={busy}>{busy && <span className="register-spinner" aria-hidden="true" />}{busy ? 'Creating account…' : 'Create account'}</button>
      <button type="button" className="register-back" disabled={busy} onClick={() => { setStep(2); setMessage('') }}>Request a new code</button>
    </form>}
    {message && step === 2 && <p className="auth-inline-error" role="alert">{message}</p>}
    <p className="login-switch-copy">Already have an account? <a href="/login" onClick={onLogin}>Sign in</a></p>
    <p className="login-terms">By continuing, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.</p>
  </div></div>
}
