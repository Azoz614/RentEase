import { useEffect, useRef, useState } from 'react'

export function useModalDismiss(onDismiss) {
  const [closing, setClosing] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const dismiss = () => {
    if (timer.current) return
    setClosing(true)
    timer.current = setTimeout(onDismiss, 160)
  }
  return [dismiss, closing]
}
