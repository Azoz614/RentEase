import { useCallback, useEffect, useRef, useState } from 'react'

export const notificationsChanged = () => window.dispatchEvent(new window.Event('rentease:notifications'))
export function useNotificationCount(api, fallback = 0, enabled = true) {
  const [count, setCount] = useState(fallback), sequence = useRef(0)
  const load = useCallback(async () => {
    const current = ++sequence.current
    try {
      const result = await api('/api/inbox?limit=1')
      if (current === sequence.current && Number.isFinite(result.unreadCount)) setCount(result.unreadCount)
    } catch { /* Retain the last confirmed count during network interruptions. */ }
  }, [api])
  useEffect(() => {
    if (!enabled) return
    const refresh = () => { if (document.visibilityState !== 'hidden') load() }
    queueMicrotask(refresh)
    const timer = setInterval(refresh, 20000)
    window.addEventListener('focus', refresh)
    window.addEventListener('rentease:notifications', refresh)
    window.addEventListener('rentease:delivery', refresh)
    return () => {
      sequence.current += 1; clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('rentease:notifications', refresh)
      window.removeEventListener('rentease:delivery', refresh)
    }
  }, [load, enabled])
  return enabled ? count : fallback
}
