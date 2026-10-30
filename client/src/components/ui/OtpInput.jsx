import { useId, useRef, useState } from 'react'
import './otp-input.css'

export function OtpInput({ value, onChange, name, disabled = false, status = 'idle',
  label = 'Verification code', digitLabel, describedBy, inputRefs, className = '', autoFocus = false }) {
  const [internal, setInternal] = useState('')
  const ownRefs = useRef([]), refs = inputRefs || ownRefs, id = useId()
  const code = value ?? internal
  const digits = code.padEnd(6, ' ').slice(0, 6).split('').map((digit) => /\d/.test(digit) ? digit : '')
  const update = (text, index) => {
    const numbers = text.replace(/\D/g, '').slice(0, 6)
    const start = numbers.length === 6 ? 0 : index
    const next = [...digits]
    if (!numbers) next[index] = ''
    else [...numbers].slice(0, 6 - start).forEach((digit, offset) => { next[start + offset] = digit })
    const nextCode = next.map((digit) => digit || ' ').join('').trimEnd()
    setInternal(nextCode)
    onChange?.(nextCode)
    if (numbers) refs.current[Math.min(5, start + numbers.length)]?.focus()
  }
  return (
    <div className={`otp-input ${className} is-${status}`} role="group" aria-label={label} aria-describedby={describedBy}>
      {name && <input type="hidden" name={name} value={code} />}
      {digits.map((digit, index) => (
        <input key={index} id={`${id}-${index}`} ref={(node) => { refs.current[index] = node }}
          type="text" inputMode="numeric" pattern="[0-9]" maxLength={6} required
          autoComplete={index === 0 ? 'one-time-code' : 'off'} autoFocus={autoFocus && index === 0}
          aria-label={digitLabel ? digitLabel(index) : `${label}, digit ${index + 1}`}
          aria-invalid={status === 'error'} aria-describedby={describedBy}
          value={digit} disabled={disabled} placeholder="–"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => update(event.target.value, index)}
          onPaste={(event) => { event.preventDefault(); update(event.clipboardData.getData('text'), index) }}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !digit && index) {
              event.preventDefault()
              refs.current[index - 1]?.focus()
            }
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              refs.current[Math.max(0, Math.min(5, index + (event.key === 'ArrowLeft' ? -1 : 1)))]?.focus()
            }
            if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault()
              refs.current[event.key === 'Home' ? 0 : 5]?.focus()
            }
          }} />
      ))}
    </div>
  )
}
