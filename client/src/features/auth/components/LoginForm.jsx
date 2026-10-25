import { useState } from 'react'
import { readJsonResponse } from '../../../services/http.js'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'

export default function LoginForm({ onRegister, onLoginSuccess }) {
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
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
      setIsSubmitting(false)
    }
  }

  return (
    <div className="login-panel">
      <div className="login-form-content">
        <div className="login-heading">
          <span className="login-eyebrow">WELCOME BACK</span>
          <h2>
            Welcome back.
            <br />
            <em>Make yourself at home.</em>
          </h2>
        </div>

        <div className="login-social-row">
          <button type="button" className="login-social-button">
            <span className="google-mark">G</span>Continue with Google
          </button>
          <button type="button" className="login-social-button">
            <span className="facebook-mark">f</span>Continue with Facebook
          </button>
        </div>
        <div className="re-auth-assurance">
          <UiIcon name="shield" size={16} />
          Secure access to your rental account
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="login-email">Email address</label>
          <div className="login-input-wrap">
            <UiIcon name="mail" size={18} />
            <input
              id="login-email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div className="login-password-label">
            <label htmlFor="login-password">Password</label>
            <a href="/forgot-password">Forgot password?</a>
          </div>
          <div className="login-input-wrap">
            <UiIcon name="lock" size={18} />
            <input
              id="login-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="login-password-toggle"
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          <button type="submit" className="login-submit" disabled={isSubmitting}>
            <span className="login-button-label">
              {isSubmitting ? 'Signing you in...' : 'Sign in'}
            </span>
            <UiIcon name="arrow" size={18} />
            {isSubmitting && (
              <span className="login-entry-scene" aria-hidden="true">
                <i className="login-entry-door" />
                <i className="login-entry-person" />
              </span>
            )}
          </button>
        </form>

        {message && (
          <p className="login-feedback" role="status">
            {message}
          </p>
        )}
        <p className="login-switch-copy">
          New around here?{' '}
          <a href="/register" onClick={onRegister}>
            Create an account
          </a>
        </p>
        <p className="login-terms">
          By continuing, you agree to RentEase’s <a href="/terms">Terms of Service</a> and{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </div>
    </div>
  )
}
