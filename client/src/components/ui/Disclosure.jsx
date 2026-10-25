import { useState } from 'react'

import { UiIcon } from './UiIcon.jsx'

export function Disclosure({ icon = 'map', title, description, children }) {
  const [mounted, setMounted] = useState(false)
  return (
    <details
      className="re-disclosure"
      onToggle={(event) => {
        if (event.currentTarget.open) setMounted(true)
      }}
    >
      <summary>
        <span className="re-disclosure-icon">
          <UiIcon name={icon} />
        </span>
        <span>
          <b>{title}</b>
          {description && <small>{description}</small>}
        </span>
        <UiIcon name="chevron" />
      </summary>
      {mounted && <div className="re-disclosure-body">{children}</div>}
    </details>
  )
}
