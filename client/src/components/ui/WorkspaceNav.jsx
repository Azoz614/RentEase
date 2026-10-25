import { useRef } from 'react'

const navigationIcons = {
  overview: 'grid',
  inventory: 'box',
  products: 'box',
  calendar: 'calendar',
  add: 'plus',
  bookings: 'orders',
  requests: 'orders',
  packages: 'box',
  handovers: 'shield',
  users: 'users',
  shops: 'store',
  identity: 'shield',
  locations: 'map',
  deliveries: 'truck',
  inbox: 'mail',
  notifications: 'bell',
  reports: 'chart',
  coupons: 'tag',
  activity: 'history',
}

import { UiIcon } from './UiIcon.jsx'

export function WorkspaceNav({ items, active, onSelect, onLogout, label, className = '' }) {
  const mobile = useRef(null)
  const select = (id) => {
    onSelect(id)
    if (mobile.current) mobile.current.open = false
  }
  const links = () =>
    items.map((item) => (
      <button
        key={item.id}
        type="button"
        className={active === item.id ? 'active selected is-active' : ''}
        aria-current={active === item.id ? 'page' : undefined}
        onClick={() => select(item.id)}
      >
        <UiIcon name={item.icon || navigationIcons[item.id]} />
        <span>{item.label}</span>
        {item.badge > 0 && <b>{item.badge}</b>}
      </button>
    ))
  return (
    <>
      <nav className={`re-workspace-nav ${className}`} aria-label={label}>
        {links()}
      </nav>
      <details
        ref={mobile}
        className="re-mobile-workspace-nav"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            mobile.current.open = false
            mobile.current.querySelector('summary')?.focus()
          }
        }}
      >
        <summary>
          <UiIcon name="menu" />
          <span>{items.find((item) => item.id === active)?.label || 'Workspace menu'}</span>
          <UiIcon name="chevron" />
        </summary>
        <nav aria-label={`${label} mobile`}>
          {links()}
          {onLogout && (
            <button type="button" className="re-mobile-signout" onClick={onLogout}>
              <UiIcon name="logout" />
              <span>Sign out</span>
            </button>
          )}
        </nav>
      </details>
    </>
  )
}
