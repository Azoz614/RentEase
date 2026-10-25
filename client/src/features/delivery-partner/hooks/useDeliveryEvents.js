import { useEffect } from 'react'

export function useDeliveryConnection(api, enabled) {
  useEffect(() => {
    if (!enabled || !api.stream) return
    const controller = new AbortController()
    let timer
    const connect = async () => {
      try {
        const response = await api.stream('/api/delivery/events', controller.signal)
        const reader = response.body.getReader(),
          decoder = new TextDecoder()
        let buffer = ''
        try {
          while (!controller.signal.aborted) {
            const chunk = await reader.read()
            if (chunk.done) break
            buffer += decoder.decode(chunk.value, { stream: true })
            let end
            while ((end = buffer.indexOf('\n\n')) >= 0) {
              const event = buffer.slice(0, end)
              buffer = buffer.slice(end + 2)
              if (event.startsWith('data:')) window.dispatchEvent(new Event('rentease:delivery'))
            }
          }
        } finally {
          reader.releaseLock()
        }
      } catch (error) {
        if ([401, 403].includes(error.status)) return
      }
      if (!controller.signal.aborted) timer = setTimeout(connect, 3000)
    }
    connect()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [api, enabled])
}

export function useDeliveryRefresh(refresh) {
  useEffect(() => {
    let timer
    const changed = () => {
      clearTimeout(timer)
      timer = setTimeout(() => refresh(), 120)
    }
    window.addEventListener('rentease:delivery', changed)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('rentease:delivery', changed)
    }
  }, [refresh])
}
