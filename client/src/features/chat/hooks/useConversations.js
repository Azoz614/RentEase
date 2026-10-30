import { useCallback, useEffect, useState } from 'react'
import { useDeliveryRefresh } from '../../delivery-partner/hooks/useDeliveryEvents.js'

// The signed-in customer's or shop's conversations. The live event stream also reports chat
// changes, so new messages and unread counts arrive without polling.
export default function useConversations(api) {
  const [conversations, setConversations] = useState([])
  const [unread, setUnread] = useState(0)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const result = await api('/api/chats')
      setConversations(result.conversations || [])
      setUnread(result.unread || 0)
      setError('')
    } catch (failure) {
      setError(failure.message)
    }
  }, [api])
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) refresh()
    })
    return () => {
      active = false
    }
  }, [refresh])
  useDeliveryRefresh(refresh)

  // Opens (or reuses) the conversation about a listing ({ productId }) or booking ({ requestId }).
  // A failure is shown in the chat panel the caller switches to.
  const startChat = useCallback(
    async (target) => {
      try {
        const result = await api('/api/chats', { method: 'POST', body: JSON.stringify(target) })
        setActiveId(result.conversation._id)
        await refresh()
      } catch (failure) {
        setError(failure.message)
      }
    },
    [api, refresh],
  )

  return { conversations, unread, error, activeId, setActiveId, refresh, startChat }
}
