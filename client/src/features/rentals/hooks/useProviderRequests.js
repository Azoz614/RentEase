import { useDeliveryRefresh } from '../../delivery-partner/hooks/useDeliveryEvents.js'
import { useCallback, useEffect, useRef, useState } from 'react'

export default function useProviderRequests(api, refreshKey = 0) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const state = useRef({ mounted: false, sequence: 0, controller: null })
  const refresh = useCallback(async () => {
    if (!state.current.mounted) return
    const sequence = ++state.current.sequence
    state.current.controller?.abort()
    const controller = new AbortController()
    state.current.controller = controller
    try {
      const result = await api('/api/provider/requests', {
        signal: controller.signal,
        cache: 'no-store',
      })
      if (
        controller.signal.aborted ||
        !state.current.mounted ||
        sequence !== state.current.sequence
      )
        return
      setRequests(result.requests || [])
      setError('')
    } catch (failure) {
      if (
        !controller.signal.aborted &&
        state.current.mounted &&
        sequence === state.current.sequence
      )
        setError(failure.message)
    } finally {
      if (
        !controller.signal.aborted &&
        state.current.mounted &&
        sequence === state.current.sequence
      )
        setLoading(false)
    }
  }, [api])
  useEffect(() => {
    let active = true
    const lifecycle = state.current
    lifecycle.mounted = true
    queueMicrotask(() => {
      if (active) refresh()
    })
    const visibleRefresh = () => {
      if (document.visibilityState !== 'hidden') refresh()
    }
    const timer = window.setInterval(visibleRefresh, 15000)
    window.addEventListener('focus', visibleRefresh)
    document.addEventListener('visibilitychange', visibleRefresh)
    return () => {
      active = false
      lifecycle.mounted = false
      lifecycle.sequence += 1
      lifecycle.controller?.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', visibleRefresh)
      document.removeEventListener('visibilitychange', visibleRefresh)
    }
  }, [refresh, refreshKey])
  useDeliveryRefresh(refresh)
  return { requests, loading, error, refresh }
}
