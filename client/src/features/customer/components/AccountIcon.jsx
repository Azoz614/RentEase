export default function Icon({ name }) {
  const shared = {
    width: 19,
    height: 19,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  }
  if (name === 'bell')
    return (
      <svg {...shared}>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
    )
  if (name === 'mail')
    return (
      <svg {...shared}>
        <path d="M4 6h16v12H4z" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    )
  if (name === 'rent')
    return (
      <svg {...shared}>
        <path d="M4 7h16l-1.4 13H5.4L4 7Z" />
        <path d="M9 9V6a3 3 0 0 1 6 0v3" />
        <path d="M8 12h8" />
      </svg>
    )
  if (name === 'wishlist')
    return (
      <svg {...shared}>
        <path d="M20.8 8.7c0 5.2-8.8 10.2-8.8 10.2S3.2 13.9 3.2 8.7A4.2 4.2 0 0 1 12 6.4a4.2 4.2 0 0 1 8.8 2.3Z" />
      </svg>
    )
  if (name === 'profile')
    return (
      <svg {...shared}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    )
  if (name === 'contact')
    return (
      <svg {...shared}>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <circle cx="12" cy="9" r="2.5" />
        <path d="M8 16h8" />
      </svg>
    )
  if (name === 'security')
    return (
      <svg {...shared}>
        <path d="M12 3 19 6v5c0 4.5-3 7.8-7 10-4-2.2-7-5.5-7-10V6l7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    )
  if (name === 'edit')
    return (
      <svg {...shared}>
        <path d="m14 5 5 5" />
        <path d="M4 20l4.2-.8L19 8.4 15.6 5 4.8 15.8 4 20Z" />
        <path d="M13 20h7" />
      </svg>
    )
  if (name === 'settings')
    return (
      <svg {...shared}>
        <circle cx="12" cy="12" r="3" />
        <path
          d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.8Z"
          transform="translate(-1 -1) scale(.98)"
        />
      </svg>
    )
  return (
    <svg {...shared}>
      <path d="m8 10 4 4 4-4" />
    </svg>
  )
}
