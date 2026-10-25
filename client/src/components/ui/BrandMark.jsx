export function BrandMark({ className = '' }) {
  return (
    <span className={`re-brand-mark ${className}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M9 24V8h7a6 6 0 0 1 0 12h-2m3-1 7 5"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="9" cy="24" r="1.5" fill="currentColor" />
      </svg>
    </span>
  )
}
