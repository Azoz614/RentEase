import { useRef, useState } from 'react'
import { readJsonResponse } from '../../../services/http.js'
import GoogleSignIn from './GoogleSignIn.jsx'
import { PasswordToggle } from './PasswordFields.jsx'

export default function LoginForm({ onRegister, onLoginSuccess, onForgotPassword, notice }) {
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const inFlight = useRef(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (inFlight.current || googleBusy) return
    inFlight.current = true
    setMessage('')
    const formData = new FormData(event.currentTarget)

    try {
      setIsSubmitting(true)
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.get('email'), password: formData.get('password') }),
      })
      const result = await readJsonResponse(response, 'Sign in failed.')
      onLoginSuccess(result.user, result.token)
    } catch (error) {
      setMessage(error.message || 'Could not connect to the server.')
    } finally {
      inFlight.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <div className="login-panel">
      <div className="login-form-content">
        <div className="login-heading">
          <h2>Welcome back</h2>
          <p>Sign in to your RentEase account.</p>
        </div>

        {notice?.message && <div className="auth-success-banner" role="status"><span aria-hidden="true">✓</span><p>{notice.message}</p></div>}
        <GoogleSignIn onLoginSuccess={onLoginSuccess} disabled={isSubmitting} onBusyChange={setGoogleBusy} />

        <form className="login-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
          <label htmlFor="login-email">Email</label>
          <div className="login-input-wrap">
            <input
              id="login-email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              defaultValue={notice?.email || ''}
              maxLength={254}
              disabled={isSubmitting || googleBusy}
              required
            />
          </div>
          <div className="login-password-label">
            <label htmlFor="login-password">Password</label>
            <a href="/forgot-password" onClick={onForgotPassword}>Forgot password?</a>
          </div>
          <div className="login-input-wrap">
            <input
              id="login-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              maxLength={128}
              disabled={isSubmitting || googleBusy}
              required
            />
            <PasswordToggle visible={showPassword} onToggle={() => setShowPassword((shown) => !shown)} />
          </div>
          {message && <p className="auth-inline-error" role="alert">{message}</p>}
          <button type="submit" className="login-submit" disabled={isSubmitting || googleBusy}>
            {isSubmitting && <span className="register-spinner" aria-hidden="true" />}
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="login-switch-copy">
          New to RentEase? <a href="/register" onClick={onRegister}>Create an account</a>
        </p>
        <p className="login-terms">
          By continuing, you agree to our <a href="/terms">Terms</a> and <a href="/privacy">Privacy Policy</a>.
        </p>
      </div>
    </div>
  )
}
