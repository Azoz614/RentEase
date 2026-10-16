import { useEffect, useState } from 'react'
import Register from '../register/Register.jsx'
import UserHome, { GuestBrowse } from '../home/UserHome.jsx'
import AdminPage from '../admin/AdminPage.jsx'
import { readJsonResponse } from '../../utils/readJsonResponse.js'
import './login.css'

const SESSION_KEY = 'rentease.session.v1'

function readSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    return saved?.token && saved?.user ? saved : null
  } catch { return null }
}

function LoginForm({ onRegister, onLoginSuccess }) {
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
          <h2>Sign in to<br /><em>RentEase.</em></h2>
        </div>

        <div className="login-social-row">
          <button type="button" className="login-social-button"><span className="google-mark">G</span>Continue with Google</button>
          <button type="button" className="login-social-button"><span className="facebook-mark">f</span>Continue with Facebook</button>
        </div>
        <div className="login-divider"><span>or continue with email</span></div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="login-email">Email address</label>
          <div className="login-input-wrap"><span aria-hidden="true">✉</span><input id="login-email" name="email" type="email" placeholder="you@example.com" autoComplete="email" required /></div>
          <div className="login-password-label">
            <label htmlFor="login-password">Password</label>
            <a href="/forgot-password">Forgot password?</a>
          </div>
          <div className="login-input-wrap"><span aria-hidden="true">▣</span><input id="login-password" name="password" type={showPassword ? 'text' : 'password'} placeholder="Enter your password" autoComplete="current-password" required /><button type="button" className="login-password-toggle" onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? 'Hide' : 'Show'}</button></div>
          <button type="submit" className="login-submit" disabled={isSubmitting}>
            <span className="login-button-label">Sign in</span>
            {isSubmitting && <span className="login-entry-scene" aria-hidden="true"><i className="login-entry-door" /><i className="login-entry-person" /></span>}
          </button>
        </form>

        {message && <p className="login-feedback" role="status">{message}</p>}
        <p className="login-switch-copy">New around here? <a href="/register" onClick={onRegister}>Create an account</a></p>
        <p className="login-terms">By continuing, you agree to RentEase’s <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</p>
      </div>
    </div>
  )
}

function Login() {
  const [isRegistering, setIsRegistering] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [session, setSession] = useState(readSession)
  const [restoringSession, setRestoringSession] = useState(() => Boolean(readSession()?.token))

  useEffect(() => {
    if (!session?.token) return
    let mounted = true
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${session.token}` } })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            if (mounted) {
              setSession(null)
              try { localStorage.removeItem(SESSION_KEY) } catch { /* Ignore unavailable browser storage. */ }
            }
          }
          return
        }
        const result = await readJsonResponse(response, 'Could not restore your session.')
        if (!mounted) return
        const nextSession = { user: result.user, token: session.token }
        setSession(nextSession)
        try { localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession)) } catch { /* The current tab can continue without persistent storage. */ }
      })
      .catch(() => { /* Keep the saved session if the server is temporarily unreachable. */ })
      .finally(() => { if (mounted) setRestoringSession(false) })
    return () => { mounted = false }
  }, [])

  const user = session?.user || null
  const token = session?.token || ''

  if (restoringSession) return <main className="session-restoring"><span className="register-spinner" aria-hidden="true" /><p>Restoring your RentEase session...</p></main>

  if (user) {
    const logout = () => {
      setSession(null)
      setShowAuth(false)
      try { localStorage.removeItem(SESSION_KEY) } catch { /* Ignore unavailable browser storage. */ }
    }
    return user.role === 'admin'
      ? <AdminPage user={user} token={token} onLogout={logout} />
      : <UserHome user={user} token={token} onLogout={logout} onAccountUpdate={(updatedUser) => {
        setSession((current) => {
          const nextSession = { ...current, user: { ...current.user, ...updatedUser } }
          try { localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession)) } catch { /* Current tab can continue without persistent storage. */ }
          return nextSession
        })
      }} />
  }

  const onLoginSuccess = (nextUser, nextToken) => {
    const nextSession = { user: nextUser, token: nextToken }
    setSession(nextSession)
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession)) } catch { /* Keep the session in memory if browser storage is unavailable. */ }
  }

  const showRegister = (event) => {
    event.preventDefault()
    setShowAuth(true)
    setIsRegistering(true)
  }

  const showLogin = (event) => {
    event.preventDefault()
    setShowAuth(true)
    setIsRegistering(false)
  }

  if (!showAuth) return <GuestBrowse onSignIn={() => { setShowAuth(true); setIsRegistering(false) }} />

  return (
    <main className={`login-page${isRegistering ? ' is-registering-page' : ''}`}>
      <header className="login-nav">
        <a className="login-brand" href="/" aria-label="RentEase home">
          <span className="login-brand-mark" aria-hidden="true">r</span>
          <span><b>RentEase</b></span>
        </a>
        <div className="login-nav-signup">
          <a href="/" onClick={(event) => { event.preventDefault(); setShowAuth(false); setIsRegistering(false) }}>Browse listings</a>
          <span>{isRegistering ? 'Already have an account?' : 'New to RentEase?'}</span>
          <a href={isRegistering ? '/login' : '/register'} onClick={isRegistering ? showLogin : showRegister}>
            {isRegistering ? 'Sign in' : 'Create an account'}
          </a>
        </div>
      </header>

      <section className={`login-layout${isRegistering ? ' is-registering' : ''}`} aria-label="RentEase account access">
        <aside className="login-story">
          <div className="login-story-copy">
            <span className="login-story-kicker">TOOLS · GEAR · SPACES</span>
            <h1>The right gear.<br /><em>Right when you need it.</em></h1>
            <p>Rent quality equipment and everyday essentials from people and organizations in your community.</p>
          </div>
          <div className="login-story-caption">GOOD GEAR. SHARED WELL.</div>
        </aside>

        {isRegistering
          ? <Register onLogin={showLogin} />
          : <LoginForm onRegister={showRegister} onLoginSuccess={onLoginSuccess} />}
      </section>
    </main>
  )
}

export default Login
