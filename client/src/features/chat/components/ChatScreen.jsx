import { useEffect } from 'react'
import { BrandMark } from '../../../components/ui/BrandMark.jsx'
import ChatPanel from './ChatPanel.jsx'
import '../styles/chat.css'

// The customer's messages as a full-screen page over the marketplace, like a product page.
export default function ChatScreen({ api, chats, onBack }) {
  useEffect(() => {
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [])
  return (
    <section className="chat-screen" aria-labelledby="chat-screen-title">
      <header className="chat-screen-bar">
        <button type="button" className="chat-screen-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back to rentals
        </button>
        <h1 id="chat-screen-title">Messages</h1>
        <span className="chat-screen-brand">
          <BrandMark className="market-logo" />
          RentEase
        </span>
      </header>
      <ChatPanel api={api} chats={chats} side="customer" />
    </section>
  )
}
