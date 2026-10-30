import { BrandMark } from '../../../components/ui/BrandMark.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import Icon from './AccountIcon.jsx'
import NotificationBell from '../../notifications/components/NotificationBell.jsx'
import { useRef } from 'react'
import { useDismiss } from '../../../components/ui/useDismiss.js'

export default function CustomerNavigation({
  animateSignOut,
  loyaltyPoints,
  loyalty,
  openInbox,
  openProfileSettings,
  panel,
  profileMenuOpen,
  returnToBrowse,
  setPanel,
  setProfileMenuOpen,
  unread,
  user,
  api,
  onNotification,
  chatUnread = 0,
}) {
  const profileMenu = useRef(null),
    profileTrigger = useRef(null)
  useDismiss(profileMenu, profileMenuOpen, () => setProfileMenuOpen(false), profileTrigger)
  return (
    <header className="market-nav">
      <a className="market-brand" href="/">
        <BrandMark className="market-logo" />
        RentEase
      </a>
      <nav className="market-primary-nav" aria-label="Rental navigation">
        <button
          type="button"
          className={panel === 'browse' ? 'active' : ''}
          aria-pressed={panel === 'browse'}
          onClick={returnToBrowse}
        >
          <UiIcon name="grid" size={18} />
          Explore rentals
        </button>
        <button
          className={`market-icon-button market-rentals-link${panel === 'requests' ? ' active' : ''}`}
          aria-label="My rentals"
          aria-pressed={panel === 'requests'}
          title="My rentals"
          onClick={() => setPanel('requests')}
        >
          <Icon name="rent" />
          <span>My rentals</span>
        </button>
        <button
          type="button"
          className={`market-rewards-link${panel === 'rewards' ? ' active' : ''}`}
          aria-pressed={panel === 'rewards'}
          aria-label={`Rewards, level ${loyalty?.level ?? 0}${loyalty?.rewardsAvailable ? `, ${loyalty.rewardsAvailable} ready` : ''}`}
          onClick={() => setPanel('rewards')}
        >
          <UiIcon name="star" size={18} />
          <span>Rewards</span>
          <small className="market-rewards-level">Lv {loyalty?.level ?? 0}</small>
          {loyalty?.rewardsAvailable > 0 && <i className="market-rewards-dot" aria-hidden="true" />}
        </button>
      </nav>
      <div className="market-actions">
        <button
          className={`market-icon-button${panel === 'wishlist' ? ' active' : ''}`}
          aria-label="Wishlist"
          title="Wishlist"
          onClick={() => setPanel('wishlist')}
        >
          <Icon name="wishlist" />
        </button>
        <button
          className={`market-icon-button${panel === 'messages' ? ' active' : ''}`}
          aria-label={`Messages${chatUnread ? `, ${chatUnread} unread` : ''}`}
          title="Messages"
          onClick={() => setPanel('messages')}
        >
          <UiIcon name="chat" size={20} />
          {chatUnread > 0 && <span className="inbox-count">{chatUnread}</span>}
        </button>
        <NotificationBell api={api} fallback={unread} onHistory={openInbox} onNavigate={onNotification} />
        <div className="profile-menu-wrap" ref={profileMenu}>
          <button
            ref={profileTrigger}
            className="profile-trigger"
            aria-expanded={profileMenuOpen}
            aria-label="Open profile menu"
            onClick={() => setProfileMenuOpen((open) => !open)}
          >
            <span className="profile-avatar">{user.username?.[0]?.toUpperCase() || 'U'}</span>
            <span className="profile-trigger-name">
              <b>{user.username}</b>
              <small>Customer</small>
            </span>
            <Icon name="chevron" />
          </button>
          {profileMenuOpen && (
            <div className="profile-dropdown">
              <div className="profile-dropdown-info">
                <span className="profile-dropdown-avatar">
                  {user.username?.charAt(0)?.toUpperCase() || 'U'}
                </span>
                <div>
                  <b>{user.username}</b>
                  <small>Customer</small>
                  <button
                    type="button"
                    className="profile-dropdown-points"
                    onClick={() => {
                      setProfileMenuOpen(false)
                      setPanel('rewards')
                    }}
                  >
                    {loyaltyPoints} loyalty points · Level {loyalty?.level ?? 0} →
                  </button>
                </div>
              </div>
              <div className="profile-dropdown-sections">
                <button
                  type="button"
                  className="profile-dropdown-item"
                  onClick={() => openProfileSettings('profile')}
                >
                  <span className="profile-item-icon">
                    <Icon name="profile" />
                  </span>
                  <span>
                    <b>Profile</b>
                    <small>Your name and NIC</small>
                  </span>
                  <Icon name="chevron" />
                </button>
                <button
                  type="button"
                  className="profile-dropdown-item"
                  onClick={() => openProfileSettings('contact')}
                >
                  <span className="profile-item-icon">
                    <Icon name="contact" />
                  </span>
                  <span>
                    <b>Contact information</b>
                    <small>Email, phone and address</small>
                  </span>
                  <Icon name="chevron" />
                </button>
                <button
                  type="button"
                  className="profile-dropdown-item"
                  onClick={() => {
                    setProfileMenuOpen(false)
                    setPanel('addresses')
                  }}
                >
                  <span className="profile-item-icon">
                    <UiIcon name="pin" size={18} />
                  </span>
                  <span>
                    <b>Saved addresses</b>
                    <small>Delivery and return locations</small>
                  </span>
                  <Icon name="chevron" />
                </button>
                <button
                  type="button"
                  className="profile-dropdown-item"
                  onClick={() => openProfileSettings('security')}
                >
                  <span className="profile-item-icon">
                    <Icon name="security" />
                  </span>
                  <span>
                    <b>Security</b>
                    <small>Password and verification</small>
                  </span>
                  <Icon name="chevron" />
                </button>
              </div>
            </div>
          )}
        </div>
        <button className="market-logout" onClick={animateSignOut}>
          Sign out
        </button>
      </div>
    </header>
  )
}
