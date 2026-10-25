import { useCallback, useEffect, useState } from 'react'
import '../../identity/styles/identity.css'

export default function NotificationCenter({ api, onNavigate, onChange }) {
  const [notifications, setNotifications] = useState([]),
    [error, setError] = useState(''),
    [filter, setFilter] = useState('all')
  const load = useCallback(async () => {
    try {
      const result = await api('/api/inbox')
      setNotifications(result.notifications || [])
      onChange?.(result.notifications || [])
    } catch (failure) {
      setError(failure.message)
    }
  }, [api, onChange])
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) load()
    })
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') load()
    }, 20000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [load])
  const mark = async (notification) => {
    try {
      await api(`/api/notifications/${notification._id}`, {
        method: 'PATCH',
        body: JSON.stringify({ read: !notification.readAt }),
      })
      await load()
    } catch (failure) {
      setError(failure.message)
    }
  }
  const open = async (notification) => {
    if (!notification.readAt) await mark(notification)
    onNavigate(notification.link || 'requests')
  }
  const visible = notifications.filter((row) => filter === 'all' || !row.readAt)
  return (
    <section className="iv-workspace">
      <header className="iv-heading">
        <span className="iv-kicker">YOUR RENTAL UPDATES</span>
        <h1>Notifications</h1>
        <p>Identity decisions, pickup readiness and important account changes, all in one place.</p>
      </header>
      <div className="iv-toolbar">
        <label>
          Notification filter
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All updates</option>
            <option value="unread">Unread only</option>
          </select>
        </label>
        <button
          className="iv-button secondary"
          onClick={async () => {
            try {
              await api('/api/inbox/read', { method: 'PATCH', body: '{}' })
              await load()
            } catch (failure) {
              setError(failure.message)
            }
          }}
        >
          Mark all as read
        </button>
      </div>
      {error && (
        <p className="iv-alert error" role="alert">
          {error}
        </p>
      )}
      {visible.map((row) => (
        <article className={`iv-card iv-notification${row.readAt ? ' is-read' : ''}`} key={row._id}>
          <span className="iv-badge">{row.readAt ? 'READ' : 'NEW'}</span>
          <h2>{row.title}</h2>
          <p>{row.body}</p>
          <small>{new Date(row.createdAt).toLocaleString('en-LK')}</small>
          <div className="iv-actions">
            <button className="iv-button" onClick={() => open(row)}>
              View update
            </button>
            <button className="iv-button secondary" onClick={() => mark(row)}>
              {row.readAt ? 'Mark unread' : 'Mark read'}
            </button>
          </div>
        </article>
      ))}
      {!visible.length && (
        <div className="iv-card iv-empty">You’re all caught up. New updates will appear here.</div>
      )}
    </section>
  )
}
