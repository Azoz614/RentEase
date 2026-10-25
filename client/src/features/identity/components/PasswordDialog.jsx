import { useId, useLayoutEffect, useRef, useState } from 'react'

export function PasswordDialog({
  title = 'Confirm this secure change',
  description = 'Enter your current account password. It is used only to authorize this change.',
  onConfirm,
  onClose,
  progress = null,
}) {
  const dialog = useRef(null),
    id = useId(),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const inFlight = useRef(false)
  useLayoutEffect(() => {
    const node = dialog.current,
      previous = document.activeElement
    node.showModal()
    return () => {
      node.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  const submit = async (event) => {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try {
      await onConfirm(password)
    } catch (failure) {
      setError(failure.message)
    } finally {
      setPassword('')
      inFlight.current = false
      setBusy(false)
    }
  }
  return (
    <dialog
      ref={dialog}
      className="iv-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
    >
      <form onSubmit={submit}>
        <span className="iv-kicker">PROTECTING YOUR ACCOUNT</span>
        <h2 id={id}>{title}</h2>
        <p>{description}</p>
        <label>
          Current password
          <input
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
            autoFocus
          />
        </label>
        {progress !== null && (
          <div role="status">
            <progress value={progress} max="100" aria-label="Identity upload progress" />
            <p>
              {progress < 100
                ? `Uploading securely… ${progress}%`
                : 'Validating and encrypting your documents…'}
            </p>
          </div>
        )}
        {error && (
          <p className="iv-alert error" role="alert">
            {error}
          </p>
        )}
        <div className="iv-actions">
          <button className="iv-button secondary" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="iv-button" disabled={busy || !password}>
            {busy ? 'Authorizing…' : 'Confirm securely'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
