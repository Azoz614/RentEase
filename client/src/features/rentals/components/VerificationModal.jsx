import { useCallback, useEffect, useRef, useState } from 'react'

import { shortId } from '../utils/handoverPresentation.js'
import { Glyph } from './Glyph.jsx'
import { useModalDismiss } from '../hooks/useModalDismiss.js'
import { Modal } from './Modal.jsx'

export function VerificationModal({ rental, type, request, onClose: onDismiss, onVerified }) {
  const [onClose, closing] = useModalDismiss(onDismiss)
  const [challenge, setChallenge] = useState(null)
  const [digits, setDigits] = useState(Array(6).fill(''))
  const [sending, setSending] = useState(true)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const [expiresAt, setExpiresAt] = useState(0)
  const [now, setNow] = useState(Date.now)
  const [locked, setLocked] = useState(false)
  const inputs = useRef([])
  const started = useRef(false)
  const mounted = useRef(true)
  const action = type === 'pickup' ? 'Pickup' : 'Return'
  const send = useCallback(async () => {
    setSending(true)
    setError('')
    setDigits(Array(6).fill(''))
    setLocked(false)
    setChallenge(null)
    try {
      const result = await request(`/rentals/${rental._id}/verification/${type}`)
      if (!result.challengeId) throw new Error(`The customer has not requested a ${type} OTP yet.`)
      if (!mounted.current) return
      const offset = Date.now() - new Date(result.serverTime).getTime()
      setChallenge(result)
      setResendAt(new Date(result.resendAt).getTime() + offset)
      setExpiresAt(new Date(result.expiresAt).getTime() + offset)
      requestAnimationFrame(() => inputs.current[0]?.focus())
    } catch (err) {
      if (mounted.current) {
        setError(err.message)
        if (err.retryAfter) setResendAt(Date.now() + err.retryAfter * 1000)
      }
    } finally {
      if (mounted.current) setSending(false)
    }
  }, [request, rental._id, type])
  useEffect(() => {
    mounted.current = true
    if (!started.current) {
      started.current = true
      send()
    }
    return () => {
      mounted.current = false
    }
  }, [send])
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const cooldown = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const expiry = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const fill = (value, index) => {
    const numbers = value.replace(/\D/g, '').slice(0, 6 - index)
    setDigits((previous) => {
      const next = [...previous]
      if (!numbers) next[index] = ''
      else
        numbers.split('').forEach((number, offset) => {
          next[index + offset] = number
        })
      return next
    })
    if (numbers) inputs.current[Math.min(5, index + numbers.length)]?.focus()
    setError('')
  }
  const verify = async (event) => {
    event.preventDefault()
    if (digits.join('').length !== 6 || !challenge || verifying || sending) return
    setVerifying(true)
    setError('')
    try {
      const result = await request(`/rentals/${rental._id}/verification/${type}/verify`, {
        method: 'POST',
        body: JSON.stringify({ code: digits.join(''), challengeId: challenge.challengeId }),
      })
      if (!mounted.current) return
      setSuccess(result.message)
      await onVerified(result.message)
    } catch (err) {
      if (mounted.current) {
        setError(err.message)
        if (
          [
            'ATTEMPTS_EXHAUSTED',
            'OTP_EXPIRED',
            'CODE_UNAVAILABLE',
            'VERIFICATION_CHANGED',
            'CUSTOMER_CHANGED',
          ].includes(err.code)
        )
          setLocked(true)
        setDigits(Array(6).fill(''))
        inputs.current[0]?.focus()
      }
    } finally {
      if (mounted.current) setVerifying(false)
    }
  }
  const dismiss = () => {
    if (!verifying) onClose()
  }
  return (
    <Modal
      titleId="handover-verify-title"
      closing={closing}
      onClose={dismiss}
      className="handover-otp-modal"
    >
      <button
        className="handover-icon-button handover-modal-close"
        aria-label="Close verification"
        disabled={verifying}
        onClick={dismiss}
      >
        <Glyph name="close" />
      </button>
      {success ? (
        <div className="handover-success">
          <span>
            <Glyph name="check" width="38" height="38" />
          </span>
          <span className="handover-eyebrow">HANDOVER CONFIRMED</span>
          <h2 id="handover-verify-title">{action} verified</h2>
          <p>{success}</p>
          <button className="handover-button primary" onClick={dismiss}>
            Back to rentals <Glyph name="arrow" />
          </button>
        </div>
      ) : (
        <>
          <div className="handover-mail-icon">
            <Glyph name="mail" width="29" height="29" />
          </div>
          <span className="handover-eyebrow">SECURE CUSTOMER HANDOVER</span>
          <h2 id="handover-verify-title">Verify Rental {action}</h2>
          <p className="handover-otp-description">
            {sending ? (
              'Sending a verification code to the customer…'
            ) : challenge ? (
              <>
                A verification code has been sent to
                <br />
                <b>{challenge.maskedEmail}</b>
              </>
            ) : (
              'Send a verification code to the customer’s registered email.'
            )}
          </p>
          <div className="handover-otp-order">
            <Glyph name="box" />
            <span>
              <b>{rental.items[0]?.title}</b>
              <small>
                {shortId(rental._id)} · {rental.customerId?.username}
              </small>
            </span>
          </div>
          <form onSubmit={verify}>
            <fieldset
              disabled={sending || verifying || !challenge || locked || expiry === 0}
              className="handover-code-fieldset"
            >
              <legend>Enter the 6-digit verification code</legend>
              <div className={`handover-code-inputs${error ? ' has-error' : ''}`}>
                {digits.map((digit, index) => (
                  <input
                    key={index}
                    ref={(element) => {
                      inputs.current[index] = element
                    }}
                    aria-label={`Code digit ${index + 1}`}
                    aria-invalid={Boolean(error)}
                    onFocus={(event) => event.currentTarget.select()}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={index === 0 ? 'one-time-code' : 'off'}
                    value={digit}
                    onChange={(event) => fill(event.target.value, index)}
                    onPaste={(event) => {
                      event.preventDefault()
                      fill(event.clipboardData.getData('text'), index)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Backspace' && !digit && index > 0)
                        inputs.current[index - 1]?.focus()
                      if (event.key === 'ArrowLeft' && index > 0) {
                        event.preventDefault()
                        inputs.current[index - 1]?.focus()
                      }
                      if (event.key === 'ArrowRight' && index < 5) {
                        event.preventDefault()
                        inputs.current[index + 1]?.focus()
                      }
                    }}
                  />
                ))}
              </div>
            </fieldset>
            <div className="handover-expiry">
              <Glyph name="clock" width="14" height="14" />
              {challenge
                ? expiry
                  ? `Code expires in ${Math.floor(expiry / 60)}:${String(expiry % 60).padStart(2, '0')}`
                  : 'Code expired. Request a new one.'
                : 'Codes expire after 5 minutes.'}
            </div>
            {error && (
              <p className="handover-feedback error" role="alert" key={error}>
                {error}
              </p>
            )}
            <button
              type="submit"
              className="handover-button primary handover-verify-submit"
              disabled={
                sending ||
                verifying ||
                !challenge ||
                locked ||
                expiry === 0 ||
                digits.join('').length !== 6
              }
            >
              {(sending || verifying) && <i className="handover-spinner" />}
              {verifying ? 'Verifying code…' : sending ? 'Sending code…' : `Verify ${type}`}
              <Glyph name="arrow" width="17" />
            </button>
            <button
              type="button"
              className="handover-button secondary handover-cancel"
              disabled={verifying}
              onClick={dismiss}
            >
              Cancel
            </button>
          </form>
          <div className="handover-resend">
            <span>Didn’t receive a code?</span>
            <button disabled={sending || verifying || cooldown > 0} onClick={send}>
              {cooldown ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
          <p className="handover-otp-footnote">
            <Glyph name="shield" width="14" height="14" />
            {type === 'pickup'
              ? 'The rental starts only after successful verification.'
              : 'The return is recorded only after successful verification.'}
          </p>
        </>
      )}
    </Modal>
  )
}
