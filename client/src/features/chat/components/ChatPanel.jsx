import { useCallback, useEffect, useRef, useState } from 'react'
import { useDeliveryRefresh } from '../../delivery-partner/hooks/useDeliveryEvents.js'
import '../styles/chat.css'

const MESSAGE_LIMIT = 1000
const time = (value) => {
  const date = new Date(value)
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

// Customers and rental shops message each other here. Only display names are shared, and the
// server hides any phone number, email or messaging link typed into a message.
export default function ChatPanel({ api, chats, side }) {
  const { conversations, activeId, setActiveId, refresh, startChat, error: listError } = chats
  const active = conversations.find((conversation) => conversation._id === activeId)
  return (
    <section className={`chat-panel${activeId ? ' has-thread' : ''}`} aria-label="Messages">
      <div className="chat-list">
        <ChatSearch api={api} side={side} onPick={(id) => startChat({ contactId: id })} />
        {listError && (
          <p className="chat-error" role="alert">
            {listError}
          </p>
        )}
        {conversations.length ? (
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation._id}>
                <button
                  type="button"
                  className={conversation._id === activeId ? 'active' : ''}
                  aria-current={conversation._id === activeId ? 'true' : undefined}
                  onClick={() => setActiveId(conversation._id)}
                >
                  <span className="chat-avatar" aria-hidden="true">
                    {conversation.with[0]?.toUpperCase()}
                  </span>
                  <span className="chat-list-copy">
                    <b>{conversation.with}</b>
                    {conversation.subject && <small>{conversation.subject.title}</small>}
                    <span>
                      {conversation.lastMessage
                        ? `${conversation.lastMessage.side === side ? 'You: ' : ''}${conversation.lastMessage.body}`
                        : 'No messages yet'}
                    </span>
                  </span>
                  <span className="chat-list-meta">
                    {conversation.lastMessage && <small>{time(conversation.lastMessage.at)}</small>}
                    {conversation.unread > 0 && (
                      <i aria-label={`${conversation.unread} unread`}>{conversation.unread}</i>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="chat-empty">
            {side === 'customer'
              ? 'No conversations yet. Search for a rental shop above, or choose “Message the shop” on a listing or rental.'
              : 'Customer questions appear here. Search for a customer by username above, or message one from a booking.'}
          </p>
        )}
      </div>
      {active ? (
        <ChatThread
          key={active._id}
          api={api}
          conversation={active}
          onBack={() => setActiveId(null)}
          onSent={refresh}
        />
      ) : (
        <div className="chat-thread chat-thread-empty">
          <p>Choose a conversation to read and reply.</p>
        </div>
      )}
    </section>
  )
}

// Customers search rental shops by shop name; shops search customers by username.
function ChatSearch({ api, side, onPick }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searched, setSearched] = useState('')
  const [error, setError] = useState('')
  const latest = useRef('')
  useEffect(() => {
    const text = query.trim()
    latest.current = text
    if (text.length < 2) return
    const timer = setTimeout(async () => {
      try {
        const result = await api(`/api/chats/search?q=${encodeURIComponent(text)}`)
        // Ignore answers to an older search that arrive after a newer one.
        if (latest.current !== text) return
        setResults(result.results || [])
        setSearched(text)
        setError('')
      } catch (failure) {
        if (latest.current === text) setError(failure.message)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [api, query])
  const clear = () => {
    setQuery('')
    setResults([])
    setSearched('')
    setError('')
  }
  const open = query.trim().length >= 2
  const current = searched === query.trim()
  const label = side === 'customer' ? 'Search rental shops' : 'Search customers by username'
  return (
    <div className="chat-search">
      <input
        type="search"
        aria-label={label}
        placeholder={`${label}…`}
        maxLength={60}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') clear()
        }}
      />
      {open && (
        <div className="chat-search-results">
          {error ? (
            <p className="chat-error" role="alert">
              {error}
            </p>
          ) : current && results.length ? (
            <ul>
              {results.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => {
                      clear()
                      onPick(person.id)
                    }}
                  >
                    <span className="chat-avatar" aria-hidden="true">
                      {person.name[0]?.toUpperCase()}
                    </span>
                    <span>
                      <b>{person.name}</b>
                      <small>{person.kind}</small>
                    </span>
                    <em>Message</em>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="chat-search-none" role="status">
              {current
                ? `No ${side === 'customer' ? 'rental shops' : 'customers'} match “${query.trim()}”.`
                : 'Searching…'}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ChatThread({ api, conversation, onBack, onSent }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const scroller = useRef(null)

  // Reading the thread also marks it read on the server.
  const load = useCallback(async () => {
    try {
      const result = await api(`/api/chats/${conversation._id}/messages`)
      setMessages(result.messages || [])
      setError('')
    } catch (failure) {
      setError(failure.message)
    } finally {
      setLoading(false)
    }
  }, [api, conversation._id])
  useEffect(() => {
    let current = true
    queueMicrotask(() => {
      if (current) load()
    })
    return () => {
      current = false
    }
  }, [load])
  useDeliveryRefresh(load)
  useEffect(() => {
    const node = scroller.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages])

  const send = async (event) => {
    event?.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    setNotice('')
    try {
      const result = await api(`/api/chats/${conversation._id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      setMessages((current) => [...current, result.message])
      setDraft('')
      if (result.message.contactHidden)
        setNotice('Contact details were hidden from your message. Keep the conversation on RentEase.')
      onSent()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="chat-thread">
      <header className="chat-thread-head">
        <button type="button" className="chat-back" onClick={onBack} aria-label="Back to conversations">
          ←
        </button>
        <span className="chat-avatar" aria-hidden="true">
          {conversation.with[0]?.toUpperCase()}
        </span>
        <span>
          <b>{conversation.with}</b>
          {conversation.subject && <small>About: {conversation.subject.title}</small>}
        </span>
      </header>
      <div className="chat-messages" ref={scroller} aria-live="polite">
        {loading ? (
          <p className="chat-empty">Loading messages…</p>
        ) : messages.length ? (
          messages.map((message) => (
            <div key={message._id} className={`chat-bubble${message.mine ? ' mine' : ''}`}>
              <p>{message.body}</p>
              <small>
                {time(message.createdAt)}
                {message.contactHidden && ' · contact details hidden'}
              </small>
            </div>
          ))
        ) : (
          <p className="chat-empty">Say hello. Ask about availability, condition or pickup.</p>
        )}
      </div>
      {notice && (
        <p className="chat-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}
      <form className="chat-compose" onSubmit={send}>
        <label className="chat-sr-only" htmlFor={`chat-draft-${conversation._id}`}>
          Message {conversation.with}
        </label>
        <textarea
          id={`chat-draft-${conversation._id}`}
          rows={2}
          maxLength={MESSAGE_LIMIT}
          placeholder={`Message ${conversation.with}…`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button type="submit" disabled={sending || !draft.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
