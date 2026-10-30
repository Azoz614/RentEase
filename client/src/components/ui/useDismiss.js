import { useEffect, useRef } from 'react'

// Closes an open dropdown when the user presses anywhere outside `root`, or presses Escape
// (which also returns focus to `returnFocus`, usually the button that opened it).
export function useDismiss(root, open, close, returnFocus) {
  const latest = useRef(close)
  useEffect(() => {
    latest.current = close
  })
  useEffect(() => {
    if (!open) return
    const outside = (event) => {
      if (!root.current?.contains(event.target)) latest.current()
    }
    const escape = (event) => {
      if (event.key !== 'Escape') return
      latest.current()
      returnFocus?.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open, root, returnFocus])
}
