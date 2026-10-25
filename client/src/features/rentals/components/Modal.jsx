import { useEffect, useRef } from 'react'

export function Modal({ children, titleId, onClose, className = '', closing = false }) {
  const dialog = useRef(null)
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element.showModal()
    return () => {
      element.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`handover-modal ${className}${closing ? ' is-closing' : ''}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div>{children}</div>
    </dialog>
  )
}
