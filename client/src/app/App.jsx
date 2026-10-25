import { useDeliveryConnection } from '../features/delivery-partner/hooks/useDeliveryEvents.js'
import { useEffect, useMemo, useState } from 'react'
import { readJsonResponse, createApiClient } from '../services/http.js'
import { readSession, SESSION_KEY } from '../features/auth/services/session.js'
import LoginForm from '../features/auth/components/LoginForm.jsx'
import Register from '../features/auth/components/Register.jsx'
import { GuestBrowse } from '../features/products/pages/GuestBrowse.jsx'
import CustomerPage from '../features/customer/pages/CustomerPage.jsx'
import AdminPage from '../features/admin/pages/AdminPage.jsx'
import OwnerHome from '../features/shop-owner/pages/OwnerHome.jsx'
import DeliveryHome from '../features/delivery-partner/pages/DeliveryHome.jsx'
import AuthLayout from '../layouts/AuthLayout.jsx'

function App() {
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
      setShowAuth(false)
      try {
        localStorage.removeItem(SESSION_KEY)
      } catch {
        /* Ignore unavailable browser storage. */
      }
    }
    if (user.role === 'rental_shop')
      return <OwnerHome user={user} token={token} api={api} onLogout={logout} />
    if (user.role === 'delivery_partner')
      return <DeliveryHome user={user} api={api} onLogout={logout} />
    return user.role === 'admin' ? (
      <AdminPage user={user} token={token} onLogout={logout} />
    ) : (
      <CustomerPage
        user={user}
        token={token}
        onLogout={logout}
        onAccountUpdate={(updatedUser) => {
          setSession((current) => {
            const nextSession = { ...current, user: { ...current.user, ...updatedUser } }
            try {
              localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession))
            } catch {
              /* Current tab can continue without persistent storage. */
            }
            return nextSession
          })
        }}
      />
    )
  }

  const onLoginSuccess = (nextUser, nextToken) => {
    const nextSession = { user: nextUser, token: nextToken }
    setSession(nextSession)
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession))
    } catch {
      /* Keep the session in memory if browser storage is unavailable. */
    }
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

  if (!showAuth)
    return (
      <GuestBrowse
        onSignIn={() => {
          setShowAuth(true)
          setIsRegistering(false)
        }}
      />
    )

  return (
    <AuthLayout
      isRegistering={isRegistering}
      onBrowse={(event) => {
        event.preventDefault()
        setShowAuth(false)
        setIsRegistering(false)
      }}
      showLogin={showLogin}
      showRegister={showRegister}
    >
      {isRegistering ? (
        <Register onLogin={showLogin} />
      ) : (
        <LoginForm onRegister={showRegister} onLoginSuccess={onLoginSuccess} />
      )}
    </AuthLayout>
  )
}

export default App
