import { useLayoutEffect, useRef } from 'react'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'

// Shown when the customer adds an item from a different shop than the one already in the
// request: one request is picked up together or delivered by one rider.
export default function CartShopDialog({ conflict, onKeep, onStartNew }) {
  const dialog = useRef(null)
  useLayoutEffect(() => {
    const node = dialog.current,
      previous = document.activeElement
    node.showModal?.()
    return () => {
      node.close?.()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className="cart-shop-dialog"
      aria-labelledby="cart-shop-title"
      onCancel={(event) => {
        event.preventDefault()
        onKeep()
      }}
    >
      <span className="cart-shop-icon" aria-hidden="true">
        <UiIcon name="store" size={22} />
      </span>
      <h2 id="cart-shop-title">This item is from another shop</h2>
      <p>
        Your request has items from <b>{conflict.currentShop}</b>. One request can only include
        items from one shop, so you can pick them all up together or have one rider deliver them.
      </p>
      <p className="cart-shop-next">
        <b>{conflict.product.title}</b> is from <b>{conflict.nextShop}</b>. Send your current request
        first, or start a new request with this item.
      </p>
      <div className="cart-shop-actions">
        <button type="button" className="cart-shop-secondary" onClick={onKeep} autoFocus>
          Keep my current request
        </button>
        <button type="button" className="cart-shop-primary" onClick={onStartNew}>
          Start a new request
        </button>
      </div>
    </dialog>
  )
}
