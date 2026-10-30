import { useDeliveryConnection } from '../features/delivery-partner/hooks/useDeliveryEvents.js'
import { useEffect, useMemo, useState } from 'react'
import { readJsonResponse, createApiClient } from '../services/http.js'
import { readSession, SESSION_KEY } from '../features/auth/services/session.js'
import LoginForm from '../features/auth/components/LoginForm.jsx'
import Register from '../features/auth/components/Register.jsx'
import ForgotPassword from '../features/auth/components/ForgotPassword.jsx'
import { GuestBrowse } from '../features/products/pages/GuestBrowse.jsx'
import CustomerPage from '../features/customer/pages/CustomerPage.jsx'
import AdminPage from '../features/admin/pages/AdminPage.jsx'
import OwnerHome from '../features/shop-owner/pages/OwnerHome.jsx'
import DeliveryHome from '../features/delivery-partner/pages/DeliveryHome.jsx'
import AuthLayout from '../layouts/AuthLayout.jsx'

const AUTH_NOTICE_KEY = 'rentease.auth-notice'
const authViewFromPath = () => ({ '/login': 'login', '/register': 'register', '/forgot-password': 'recovery', '/reset-password': 'recovery' })[window.location.pathname] || 'browse'
function readAuthNotice() {
  try { return JSON.parse(sessionStorage.getItem(AUTH_NOTICE_KEY) || 'null') }
  catch { return null }
}

function App() {
  const [authView, setAuthView] = useState(authViewFromPath)
  const [authNotice, setAuthNotice] = useState(readAuthNotice)
  const isRegistering = authView === 'register'
  const showAuth = authView !== 'browse'
  const [session, setSession] = useState(readSession)
  const [restoringSession, setRestoringSession] = useState(() => Boolean(readSession()?.token))

  const navigateAuth = (view, replace = false) => {
    const path = { browse: '/', login: '/login', register: '/register', recovery: '/forgot-password' }[view]
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
    setAuthView(view)
  }
  useEffect(() => {
    const onPopState = () => setAuthView(authViewFromPath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!session?.token) return
    let mounted = true
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${session.token}` } })
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            if (mounted) {
              setSession(null)
              try {
                localStorage.removeItem(SESSION_KEY)
              } catch {
                /* Ignore unavailable browser storage. */
              }
            }
          }
          return
        }
        const result = await readJsonResponse(response, 'Could not restore your session.')
        if (!mounted) return
        const nextSession = { user: result.user, token: session.token }
        setSession(nextSession)
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession))
        } catch {
          /* The current tab can continue without persistent storage. */
        }
      })
      .catch(() => {
        /* Keep the saved session if the server is temporarily unreachable. */
      })
      .finally(() => {
        if (mounted) setRestoringSession(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  const user = session?.user || null
  const token = session?.token || ''
  const api = useMemo(() => createApiClient(token), [token])
  useDeliveryConnection(api, Boolean(user))

  if (restoringSession)
    return (
      <main className="session-restoring">
        <span className="register-spinner" aria-hidden="true" />
        <p>Restoring your RentEase session...</p>
      </main>
    )

  if (user) {
    const logout = () => {
      setSession(null)
      navigateAuth('browse', true)
      try {
        localStorage.removeItem(SESSION_KEY)
      } catch {
        /* Ignore unavailable browser storage. */
      }
    }
    const updateAccount = (updatedUser, nextToken) => {
      setSession((current) => {
        const nextSession = {
          ...current,
          user: { ...current.user, ...updatedUser },
          ...(nextToken && { token: nextToken }),
        }
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession))
        } catch {
          /* Current tab can continue without persistent storage. */
        }
        return nextSession
      })
    }
    if (user.role === 'rental_shop')
      return <OwnerHome user={user} token={token} api={api} onLogout={logout} onAccountUpdate={updateAccount} />
    if (user.role === 'delivery_partner')
      return <DeliveryHome user={user} api={api} onLogout={logout} onAccountUpdate={updateAccount} />
    return user.role === 'admin' ? (
      <AdminPage user={user} token={token} onLogout={logout} onAccountUpdate={updateAccount} />
    ) : (
      <CustomerPage user={user} token={token} onLogout={logout} onAccountUpdate={updateAccount} />
    )
  }

  const onLoginSuccess = (nextUser, nextToken) => {
    const nextSession = { user: nextUser, token: nextToken }
    setSession(nextSession)
    setAuthNotice(null)
    window.history.replaceState({}, '', '/')
    try { sessionStorage.removeItem(AUTH_NOTICE_KEY) } catch { /* Storage is optional. */ }
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession))
    } catch {
      /* Keep the session in memory if browser storage is unavailable. */
    }
  }

  const showRegister = (event) => {
    event.preventDefault()
    navigateAuth('register')
  }

  const showLogin = (event) => {
    event.preventDefault()
    navigateAuth('login')
  }

  const completeAuth = (notice) => {
    setAuthNotice(notice)
    try { sessionStorage.setItem(AUTH_NOTICE_KEY, JSON.stringify(notice)) } catch { /* Storage is optional. */ }
    navigateAuth('login', true)
  }

  if (!showAuth)
    return (
      <GuestBrowse
        onRegister={() => navigateAuth('register')}
        onSignIn={() => {
          navigateAuth('login')
        }}
      />
    )

  return (
    <AuthLayout
      isRegistering={isRegistering}
      onBrowse={(event) => {
        event.preventDefault()
        navigateAuth('browse')
      }}
      showLogin={showLogin}
      showRegister={showRegister}
    >
      {isRegistering ? (
        <Register onLogin={showLogin} onComplete={completeAuth} />
      ) : authView === 'recovery' ? (
        <ForgotPassword onLogin={showLogin} onComplete={completeAuth}
          onResetReady={() => window.history.replaceState({}, '', '/reset-password')} />
      ) : (
        <LoginForm onRegister={showRegister} onLoginSuccess={onLoginSuccess} notice={authNotice}
          onForgotPassword={(event) => { event.preventDefault(); navigateAuth('recovery') }} />
      )}
    </AuthLayout>
  )
}

export default App
