import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import '../../identity/styles/identity.css'

// Every admin change waits here for the administrator's password. A wrong password stays in the
// dialog for another try; any other outcome settles the change that opened it.
export default function AdminPasswordDialog({ prompt, onClose }) {
  const dialog = useRef(null),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [lockedUntil, setLockedUntil] = useState(0)
  useLayoutEffect(() => {
    const node = dialog.current,
      previous = document.activeElement
    node.showModal()
    return () => {
      node.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  useEffect(() => {
    if (!lockedUntil) return
    const timer = window.setTimeout(() => setLockedUntil(0), Math.max(0, lockedUntil - Date.now()))
    return () => window.clearTimeout(timer)
  }, [lockedUntil])
  const cancel = () => {
    if (busy) return
    prompt.reject(Object.assign(new Error('Change cancelled.'), { cancelled: true }))
    onClose()
  }
  const submit = async (event) => {
    event.preventDefault()
    if (busy || lockedUntil) return
    setBusy(true)
    setError('')
    try {
      const result = await prompt.send(password)
      prompt.resolve(result)
      onClose()
    } catch (failure) {
      setPassword('')
      if (['PASSWORD_INCORRECT', 'PASSWORD_REQUIRED', 'APPROVAL_LOCKED'].includes(failure.code)) {
        setError(failure.message)
        if (failure.code === 'APPROVAL_LOCKED' && failure.retryAfter)
          setLockedUntil(Date.now() + failure.retryAfter * 1000)
      } else {
        prompt.reject(failure)
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="iv-dialog"
      aria-labelledby="admin-password-title"
      onCancel={(event) => {
        event.preventDefault()
        cancel()
      }}
    >
      <form onSubmit={submit}>
        <span className="iv-kicker">ADMIN CONFIRMATION</span>
        <h2 id="admin-password-title">Confirm with your password</h2>
        <p>
          {prompt.summary || 'This change takes effect immediately.'} Enter your account password
          to continue. After 3 incorrect attempts, changes are locked for 10 minutes.
        </p>
        <label>
          Account password
          <input
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            autoFocus
            value={password}
            disabled={Boolean(lockedUntil)}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && (
          <p className="iv-alert error" role="alert">
            {error}
          </p>
        )}
        <div className="iv-actions">
          <button type="button" className="iv-button secondary" disabled={busy} onClick={cancel}>
            Cancel
          </button>
          <button className="iv-button" disabled={busy || Boolean(lockedUntil)}>
            {busy ? 'Confirming…' : lockedUntil ? 'Changes locked' : 'Confirm change'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
