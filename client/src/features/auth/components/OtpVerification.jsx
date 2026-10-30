import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { OtpInput } from '../../../components/ui/OtpInput.jsx'

export function OtpVerification({ email, challenge, onVerify, onVerified, onResend, onBack }) {
  const [otp, setOtp] = useState(''), [status, setStatus] = useState('idle')
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [now, setNow] = useState(Date.now)
  const [resending, setResending] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [receivedAt] = useState(Date.now)
  const inputs = useRef([]), inFlight = useRef(false), timer = useRef(null), mounted = useRef(true), id = useId()
  const times = useMemo(() => {
    const offset = (challenge.receivedAt || receivedAt) - new Date(challenge.serverTime).getTime()
    return { expires: new Date(challenge.expiresAt).getTime() + offset, resend: new Date(challenge.resendAt).getTime() + offset }
  }, [challenge, receivedAt])
  useEffect(() => {
    mounted.current = true
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { mounted.current = false; clearInterval(clock); clearTimeout(timer.current) }
  }, [])
  const expires = Math.max(0, Math.ceil((times.expires - now) / 1000))
  const cooldown = Math.max(0, Math.ceil((Math.max(times.resend, retryAt) - now) / 1000))
  const verify = async (event) => {
    event.preventDefault()
    if (inFlight.current || !/^\d{6}$/.test(otp) || !expires) return
    inFlight.current = true; setBusy(true); setResending(false); setError(''); setNotice('')
    try {
      const result = await onVerify(otp)
      if (!mounted.current) return
      setStatus('success')
      timer.current = setTimeout(() => { if (mounted.current) onVerified(result) }, 850)
    } catch (failure) {
      if (!mounted.current) return
      setStatus('error'); setError(failure.message)
      inFlight.current = false; setBusy(false)
      inputs.current[0]?.focus()
    }
  }
  const resend = async () => {
    if (inFlight.current || cooldown) return
    inFlight.current = true; setBusy(true); setResending(true); setError(''); setNotice('')
    try {
      await onResend()
      if (!mounted.current) return
      setOtp(''); setStatus('idle'); setNotice('New code requested. Check your inbox and spam folder.')
      setNow(Date.now()); inputs.current[0]?.focus()
    } catch (failure) {
      if (!mounted.current) return
      setError(failure.message)
      if (failure.retryAfter) setRetryAt(Date.now() + failure.retryAfter * 1000)
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return <div className="auth-verification">
    <form className="login-form" onSubmit={verify} aria-busy={busy}>
      <OtpInput label={`Verification code sent to ${email}`} value={otp} onChange={(value) => { setOtp(value); setStatus('idle'); setError('') }}
        inputRefs={inputs} disabled={busy || status === 'success' || !expires} status={status}
        describedBy={`${id}-feedback ${id}-expiry`} autoFocus />
      <div id={`${id}-feedback`} aria-live="polite" aria-atomic="true">
        {status === 'success' && <p className="auth-success"><span aria-hidden="true">✓</span> Email verified successfully</p>}
        {error && <p className="auth-inline-error" role="alert">{error}</p>}
        {notice && <p className="auth-field-hint">{notice}</p>}
      </div>
      <p id={`${id}-expiry`} className="auth-expiry">{expires ? `Code expires in ${Math.floor(expires / 60)}:${String(expires % 60).padStart(2, '0')}` : 'Your code has expired. Request a new one.'}</p>
      <button className="login-submit" disabled={busy || !expires || !/^\d{6}$/.test(otp)}>
        {busy && status !== 'success' && <span className="register-spinner" aria-hidden="true" />}
        {status === 'success' ? 'Verified — continuing…' : busy ? resending ? 'Sending code…' : 'Verifying…' : 'Verify email'}
      </button>
    </form>
    <div className="auth-code-actions">
      <button type="button" className="register-back" disabled={busy} onClick={onBack}>Change email</button>
      <button type="button" className="register-back" disabled={busy || cooldown > 0} onClick={resend}>
        {cooldown ? `Resend in ${cooldown}s` : 'Resend code'}
      </button>
    </div>
  </div>
}
