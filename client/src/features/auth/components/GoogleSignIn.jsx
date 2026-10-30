import { useCallback, useEffect, useRef, useState } from 'react'
import { readJsonResponse } from '../../../services/http.js'
import { authPost } from '../services/auth.js'
import { loadGoogleIdentity } from '../services/google.js'
import { PasswordFields } from './PasswordFields.jsx'
import { passwordError } from '../services/auth.js'

export default function GoogleSignIn({ onLoginSuccess, disabled = false, onBusyChange }) {
  const host = useRef(null), mounted = useRef(false), inFlight = useRef(false), credential = useRef('')
  const [version, setVersion] = useState(0), [state, setState] = useState('loading')
  const [message, setMessage] = useState(''), [required, setRequired] = useState('')
  useEffect(() => { onBusyChange?.(state === 'verifying') }, [state, onBusyChange])
  const signIn = useRef(null)
  const submitGoogle = useCallback(async (token, extra = {}) => {
    if (inFlight.current) return
    inFlight.current = true; setState('verifying'); setMessage('Signing you in…')
    try {
      const result = await authPost('google', { credential: token, ...extra })
      if (!mounted.current) return
      credential.current = ''; setRequired(''); setState('success'); setMessage('Signed in. Redirecting…')
      onLoginSuccess(result.user, result.token)
    } catch (error) {
      if (!mounted.current) return
      setMessage(error.message); setState('error')
      if (error.code === 'GOOGLE_LINK_REQUIRED') setRequired('password')
      else if (error.code === 'GOOGLE_PROFILE_REQUIRED') setRequired('phone')
      else { credential.current = ''; setRequired('') }
    } finally { inFlight.current = false }
  }, [onLoginSuccess])
  useEffect(() => { signIn.current = submitGoogle }, [submitGoogle])
  useEffect(() => {
    mounted.current = true
    let active = true, attemptTimer
    const load = async () => {
      try {
        const config = await readJsonResponse(await fetch('/api/auth/google/config'), 'Google sign-in is unavailable.')
        if (!active) return
        if (!config.enabled) { setState('unavailable'); return }
        const identity = await loadGoogleIdentity()
        if (!active) return
        identity.initialize({ client_id: config.clientId, nonce: config.nonce, auto_select: false,
          ux_mode: 'popup', callback: (result) => {
            clearTimeout(attemptTimer)
            if (!active || !result.credential) return
            credential.current = result.credential
            signIn.current(result.credential)
          } })
        // Google caps the button at 400px; locale keeps its label in the page's language.
        identity.renderButton(host.current, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with',
          shape: 'rectangular', locale: 'en', width: Math.min(400, host.current.clientWidth || 320), click_listener: () => {
            setMessage('Choose your Google account in the pop-up window.')
            attemptTimer = setTimeout(() => { if (active && !inFlight.current) setMessage('Google sign-in wasn’t completed. Try again.') }, 45000)
          } })
        setState('ready')
      } catch (error) { if (active) { setState('error'); setMessage(error.message) } }
    }
    load()
    return () => { active = false; mounted.current = false; clearTimeout(attemptTimer) }
  }, [version])
  // Hide Google entirely when the server has not configured it.
  if (state === 'unavailable') return null
  return <div className="auth-google">
    <div ref={host} className={`auth-google-button${disabled || state === 'verifying' ? ' auth-google-disabled' : ''}${state === 'loading' ? ' is-loading' : ''}`}
      inert={disabled || state === 'verifying'} aria-busy={state === 'loading'} />
    {message && <p className={state === 'error' ? 'auth-inline-error' : 'auth-field-hint'} role={state === 'error' ? 'alert' : 'status'}>{message}</p>}
    {required && <form className="login-form auth-google-confirm" onSubmit={(event) => {
      event.preventDefault()
      const form = event.currentTarget, data = new FormData(form)
      const extra = Object.fromEntries(data.entries())
      if (required === 'phone') {
        const validation = passwordError(extra.password, extra.confirmPassword)
        if (validation) { setMessage(validation); return }
      }
      signIn.current(credential.current, extra); form.reset()
    }}>
      <label htmlFor={`google-${required}`}>{required === 'password' ? 'Existing RentEase password' : 'Contact phone number'}</label>
      <div className="login-input-wrap"><input id={`google-${required}`} name={required} type={required === 'password' ? 'password' : 'tel'}
        autoComplete={required === 'password' ? 'current-password' : 'tel'} required maxLength={required === 'password' ? 128 : 24} disabled={state === 'verifying'} /></div>
      {required === 'phone' && <PasswordFields passwordLabel="Create a RentEase password" disabled={state === 'verifying'} />}
      <button className="login-submit" disabled={state === 'verifying'}>{state === 'verifying' ? 'Verifying…' : required === 'password' ? 'Link Google securely' : 'Finish Google sign-in'}</button>
    </form>}
    {state === 'error' && !required && <button type="button" className="register-back" onClick={() => { setState('loading'); setMessage(''); setVersion((v) => v + 1) }}>Try Google again</button>}
    {state === 'ready' && message.startsWith('Choose your Google account') && <button type="button" className="register-back" onClick={() => {
      credential.current = ''; window.google?.accounts?.id?.cancel()
      setMessage('Google sign-in cancelled.'); setVersion((v) => v + 1)
    }}>Cancel Google sign-in</button>}
    <div className="login-divider">or</div>
  </div>
}
