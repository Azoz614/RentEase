import { useRef, useState } from 'react'
import { useDismiss } from '../ui/useDismiss.js'
import useAccountSettings from '../../features/customer/hooks/useAccountSettings.js'
import AccountSettingsDialog from '../../features/customer/components/AccountSettingsDialog.jsx'
import Icon from '../../features/customer/components/AccountIcon.jsx'
import { UiIcon } from '../ui/UiIcon.jsx'

const roleLabels = {
  rental_shop: 'Shop owner',
  delivery_partner: 'Delivery partner',
  admin: 'Administrator',
}
const noop = () => {}

// The same account menu and settings customers have, for shop, rider and admin workspaces.
export default function WorkspaceAccountMenu({ user, api, onLogout, onAccountUpdate }) {
  const [busy, setBusy] = useState(false)
  const root = useRef(null)
  const settings = useAccountSettings({
    user,
    api,
    savedAddress: user.defaultAddress || '',
    setBusy,
    onAccountUpdate,
    onProfileSaved: noop,
    onRestoreContact: noop,
  })
  const { profileMenuOpen: open, setProfileMenuOpen: setOpen, openProfileSettings } = settings
  useDismiss(root, open, () => setOpen(false))
  // A shop is known by its shop name; its sign-in username can be an email address, which
  // belongs only in Contact information.
  const displayName = (user.role === 'rental_shop' && user.shopName) || user.username || 'Account'
  const initial = displayName[0].toUpperCase()
  const roleLabel = roleLabels[user.role] || 'Account'
  const items = [
    ['profile', 'profile', 'Profile', user.role === 'rental_shop' ? 'Your name and shop' : 'Your name'],
    ['contact', 'contact', 'Contact information', 'Email and phone number'],
    ['security', 'security', 'Security', 'Password and verification'],
  ]
  return (
    <>
      <div className="profile-menu-wrap workspace-account" ref={root}>
        <button
          type="button"
          className="profile-trigger"
          aria-expanded={open}
          aria-label="Open profile menu"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="profile-avatar">{initial}</span>
          <span className="profile-trigger-name">
            <b>{displayName}</b>
            <small>{roleLabel}</small>
          </span>
          <Icon name="chevron" />
        </button>
        {open && (
          <div className="profile-dropdown">
            <div className="profile-dropdown-info">
              <span className="profile-dropdown-avatar">{initial}</span>
              <div>
                <b>{displayName}</b>
                <small>{roleLabel}</small>
              </div>
            </div>
            <div className="profile-dropdown-sections">
              {items.map(([section, icon, title, hint]) => (
                <button
                  type="button"
                  className="profile-dropdown-item"
                  key={section}
                  onClick={() => openProfileSettings(section)}
                >
                  <span className="profile-item-icon">
                    <Icon name={icon} />
                  </span>
                  <span>
                    <b>{title}</b>
                    <small>{hint}</small>
                  </span>
                  <Icon name="chevron" />
                </button>
              ))}
              <button type="button" className="profile-dropdown-item" onClick={onLogout}>
                <span className="profile-item-icon">
                  <UiIcon name="logout" size={18} />
                </span>
                <span>
                  <b>Sign out</b>
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
      <AccountSettingsDialog
        settings={settings}
        user={user}
        savedAddress={user.defaultAddress || ''}
        openVerification={noop}
        openAddresses={noop}
        busy={busy}
      />
    </>
  )
}
