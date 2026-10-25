import { BrandMark } from '../../../components/ui/BrandMark.jsx'
import { UiIcon } from '../../../components/ui/UiIcon.jsx'
import Icon from './AccountIcon.jsx'

export default function CustomerNavigation({
  animateSignOut,
  loyaltyPoints,
  openInbox,
  openProfileSettings,
  panel,
  profileMenuOpen,
  returnToBrowse,
  setPanel,
  setProfileMenuOpen,
  unread,
  user,
}) {
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
          className={`market-icon-button${panel === 'inbox' ? ' active' : ''}`}
          aria-label="Notifications"
          title="Notifications"
          onClick={openInbox}
        >
          <Icon name="bell" />
          {unread > 0 && <b className="inbox-count">{unread}</b>}
        </button>
        <div className="profile-menu-wrap">
          <button
            className="profile-trigger"
            aria-expanded={profileMenuOpen}
            aria-label="Open profile menu"
            onClick={() => setProfileMenuOpen((open) => !open)}
          >
            <span className="profile-avatar">{user.username?.[0]?.toUpperCase() || 'U'}</span>
            <span className="profile-trigger-name">{user.username}</span>
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
                  <small>{user.email}</small>
                  <small>{loyaltyPoints} loyalty points</small>
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
