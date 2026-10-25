import { useState } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { readJsonResponse } from '../../../services/http.js'

function Register({ onLogin }) {
  const [step, setStep] = useState(1)
  const [details, setDetails] = useState({
    name: '',
    email: '',
    phone: '',
    accountType: 'user',
    shopName: '',
  })
  const [otp, setOtp] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateDetails = (event) => {
    setDetails((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  const handleNext = async (event) => {
    event.preventDefault()
    setMessage('')
    setIsError(false)

    try {
      setIsSubmitting(true)
      const response = await fetch('/api/auth/register/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: details.name,
          email: details.email,
          phone: details.phone,
          accountType: details.accountType,
          shopName: details.shopName,
        }),
      })
      const result = await readJsonResponse(response, 'Could not send verification code.')

      setMessage(result.message)
      setStep(2)
    } catch (error) {
      setIsError(true)
      setMessage(error.message || 'Could not connect to the server.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleVerifyOtp = async (event) => {
    event.preventDefault()
    setMessage('')
    setIsError(false)

    try {
      setIsSubmitting(true)
      const response = await fetch('/api/auth/register/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: details.email, otp }),
      })
      const result = await readJsonResponse(response, 'Code verification failed.')

      setMessage(result.message)
      setStep(3)
    } catch (error) {
      setIsError(true)
      setMessage(error.message || 'Could not connect to the server.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRegister = async (event) => {
    event.preventDefault()
    setMessage('')
    setIsError(false)

    const form = event.currentTarget
    const password = new FormData(form).get('password')

    try {
      setIsSubmitting(true)
      const response = await fetch('/api/auth/register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: details.email, password }),
      })
      const result = await readJsonResponse(response, 'Registration failed.')

      setMessage(result.message || 'Account created successfully. You can now sign in.')
      form.reset()
      setDetails({ name: '', email: '', phone: '', accountType: 'user', shopName: '' })
      setOtp('')
      setStep(1)
    } catch (error) {
      setIsError(true)
      setMessage(error.message || 'Could not connect to the server.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const goBack = (previousStep) => {
    setMessage('')
    setIsError(false)
    setStep(previousStep)
  }

  const stepDescription = [
    'First, tell us how to reach you.',
    `Enter the verification code sent to ${details.email}.`,
    'Your email is verified. Now choose a password.',
  ][step - 1]

  return (
    <div className="login-panel">
      <div className="login-form-content">
        <div className="login-heading">
          <span className="login-eyebrow">START YOUR JOURNEY · STEP {step} OF 3</span>
          <h2>
            Create an account
            <br />
            with <em>RentEase.</em>
          </h2>
          <p>{stepDescription}</p>
        </div>

        <div className="login-social-row">
          <button type="button" className="login-social-button">
            <span className="google-mark">G</span>Continue with Google
          </button>
          <button type="button" className="login-social-button">
            <span className="facebook-mark">f</span>Continue with Facebook
          </button>
        </div>
        <div className="re-registration-progress" aria-label={`Registration step ${step} of 3`}>
          {[1, 2, 3].map((number) => (
            <span key={number} className={number <= step ? 'is-complete' : ''} />
          ))}
        </div>

        {step === 1 && (
          <form className="login-form" onSubmit={handleNext}>
            <label htmlFor="register-name">User name</label>
            <div className="login-input-wrap">
              <UiIcon name="user" size={18} />
              <input
                id="register-name"
                name="name"
                type="text"
                placeholder="Your name"
                autoComplete="name"
                value={details.name}
                onChange={updateDetails}
                required
              />
            </div>
            <label htmlFor="register-email">Email address</label>
            <div className="login-input-wrap">
              <UiIcon name="mail" size={18} />
              <input
                id="register-email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                value={details.email}
                onChange={updateDetails}
                required
              />
            </div>
            <label htmlFor="register-phone">Phone number</label>
            <div className="login-input-wrap">
              <UiIcon name="phone" size={18} />
              <input
                id="register-phone"
                name="phone"
                type="tel"
                placeholder="Your phone number"
                autoComplete="tel"
                value={details.phone}
                onChange={updateDetails}
                required
              />
            </div>
            <label htmlFor="register-account-type">I want to join as</label>
            <select
              id="register-account-type"
              name="accountType"
              className="admin-form-control"
              value={details.accountType}
              onChange={updateDetails}
            >
              <option value="user">Customer</option>
              <option value="rental_shop">Rental shop owner</option>
            </select>
            {details.accountType === 'rental_shop' && (
              <>
                <label htmlFor="register-shop-name">Rental shop name</label>
                <div className="login-input-wrap">
                  <UiIcon name="store" size={18} />
                  <input
                    id="register-shop-name"
                    name="shopName"
                    type="text"
                    placeholder="Your shop name"
                    value={details.shopName}
                    onChange={updateDetails}
                    required
                  />
                </div>
              </>
            )}
            <button type="submit" className="login-submit" disabled={isSubmitting}>
              <span className="login-button-label">
                {isSubmitting && <span className="register-spinner" aria-hidden="true" />}
                {isSubmitting ? 'Sending code' : 'Next'}
              </span>
              <span aria-hidden="true">→</span>
            </button>
          </form>
        )}

        {step === 2 && (
          <form className="login-form" onSubmit={handleVerifyOtp}>
            <label htmlFor="register-otp">Email verification code</label>
            <div className="login-input-wrap">
              <UiIcon name="shield" size={18} />
              <input
                id="register-otp"
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Enter 6-digit code"
                required
              />
            </div>
            <div className="register-step-actions">
              <button type="button" className="register-back" onClick={() => goBack(1)}>
                Back
              </button>
              <button type="submit" className="login-submit" disabled={isSubmitting}>
                <span className="login-button-label">
                  {isSubmitting && <span className="register-spinner" aria-hidden="true" />}
                  {isSubmitting ? 'Verifying code' : 'Verify email'}
                </span>
                <span aria-hidden="true">→</span>
              </button>
            </div>
          </form>
        )}

        {step === 3 && (
          <form className="login-form" onSubmit={handleRegister}>
            <div className="register-summary">
              <span>{details.name}</span>
              <span>{details.email}</span>
              <span>{details.phone}</span>
            </div>
            <div className="login-password-label">
              <label htmlFor="register-password">Password</label>
            </div>
            <div className="login-input-wrap">
              <UiIcon name="lock" size={18} />
              <input
                id="register-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="At least 10 characters"
                autoComplete="new-password"
                minLength={10}
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
            <div className="register-step-actions">
              <button type="button" className="register-back" onClick={() => goBack(2)}>
                Back
              </button>
              <button type="submit" className="login-submit" disabled={isSubmitting}>
                <span className="login-button-label">
                  {isSubmitting && <span className="register-spinner" aria-hidden="true" />}
                  {isSubmitting ? 'Creating account' : 'Create account'}
                </span>
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </form>
        )}

        {message && (
          <p
            className={`login-feedback${isError ? ' is-error' : ''}`}
            role={isError ? 'alert' : 'status'}
          >
            {message}
          </p>
        )}
        <p className="login-switch-copy">
          Already have an account?{' '}
          <a href="/login" onClick={onLogin}>
            Sign in
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

export default Register
