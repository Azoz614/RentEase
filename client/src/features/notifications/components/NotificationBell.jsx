import { useRef, useState } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import { useDismiss } from '../../../components/ui/useDismiss.js'
import NotificationCenter from '../pages/NotificationCenter.jsx'
import { useNotificationCount } from '../hooks/useNotificationCount.js'

export default function NotificationBell({ api, onNavigate, onHistory, fallback = 0, unreadCount }) {
  const [open, setOpen] = useState(false), count = useNotificationCount(api, unreadCount ?? fallback, unreadCount === undefined)
  const root = useRef(null), trigger = useRef(null)
  useDismiss(root, open, () => setOpen(false), trigger)
  return <div className="notification-bell-wrap" ref={root}>
    <button type="button" className="market-icon-button nc-bell-button" ref={trigger} aria-label="Notifications" title={`${count} unread notifications`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <UiIcon name="bell" size={20} />{count > 0 && <b className="inbox-count" aria-label={`${count} unread`}>{count > 99 ? '99+' : count}</b>}
    </button>
    {open && <div className="nc-dropdown" role="region" aria-label="Recent notifications"><NotificationCenter api={api} compact
      onNavigate={(target, row) => { setOpen(false); onNavigate(target, row) }} onHistory={() => { setOpen(false); onHistory() }} /></div>}
  </div>
}
