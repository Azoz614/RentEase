import { IdentityStatusCard } from '../../identity/components/IdentityStatusCard.jsx'
import { OtpInput } from '../../../components/ui/OtpInput.jsx'

import Icon from './AccountIcon.jsx'
import ProfileEditActions from './ProfileEditActions.jsx'

export default function AccountSettingsDialog({
  settings,
  user,
  identityProfile,
  savedAddress,
  openVerification,
  openAddresses,
  busy,
}) {
  const {
    activeSettingsSection,
    profileError,
    setProfileError,
    profileMessage,
    setProfileMessage,
    profileUsername,
    setProfileUsername,
    profileEmail,
    setProfileEmail,
    profilePhone,
    setProfilePhone,
    profilePassword,
    setProfilePassword,
    editingProfileSection,
    setEditingProfileSection,
    profileConfirmOpen,
    setProfileConfirmOpen,
    emailOtp,
    setEmailOtp,
    emailOtpMessage,
    setEmailOtpMessage,
    passwordAuthMethod,
    setPasswordAuthMethod,
    passwordCurrent,
    setPasswordCurrent,
    passwordOtp,
    setPasswordOtp,
    passwordOtpMessage,
    newPassword,
    setNewPassword,
    confirmNewPassword,
    setConfirmNewPassword,
    passwordError,
    passwordMessage,
    requestAccountOtp,
    requestEmailOtp,
    saveProfile,
    cancelProfileEdit,
    savePassword,
    switchSettingsSection,
  } = settings
  // NIC, residential address and identity checks only apply to customers who rent items.
  const customer = !user.role || user.role === 'user'
  const accountType =
    { rental_shop: 'Shop owner', delivery_partner: 'Delivery partner', admin: 'Administrator' }[
      user.role
    ] || 'Customer'
  return (
    <dialog className="profile-dialog account-settings-dialog" id="profile-settings">
      <form method="dialog" className="dialog-close">
        <button aria-label="Close account settings">Close</button>
      </form>
      <div className="account-settings-heading">
        <span className="account-settings-avatar" aria-hidden="true">
          {profileUsername.trim().charAt(0).toUpperCase() || 'U'}
        </span>
        <div>
          <span className="market-kicker">YOUR ACCOUNT</span>
          <h2>
            {
              {
                profile: 'Profile',
                contact: 'Contact information',
                security: 'Security',
                verification: 'Identity verification',
              }[activeSettingsSection]
            }
          </h2>
          <p>
            {
              {
                profile: customer
                  ? 'Manage your name and identity details.'
                  : 'Manage the name shown on your account.',
                contact: customer
                  ? 'Manage your email, phone, and rental address.'
                  : 'Manage your email address and phone number.',
                security: 'Keep your account protected.',
                verification: 'Manage your identity verification.',
              }[activeSettingsSection]
            }
          </p>
        </div>
        <span className="account-type-pill">{accountType}</span>
      </div>
      <nav className="account-settings-tabs" aria-label="Account settings sections">
        <button
          type="button"
          className={activeSettingsSection === 'profile' ? 'active' : ''}
          onClick={() => switchSettingsSection('profile')}
        >
          <Icon name="profile" />
          Profile
        </button>
        <button
          type="button"
          className={activeSettingsSection === 'contact' ? 'active' : ''}
          onClick={() => switchSettingsSection('contact')}
        >
          <Icon name="contact" />
          Contact information
        </button>
        <button
          type="button"
          className={activeSettingsSection === 'security' ? 'active' : ''}
          onClick={() => switchSettingsSection('security')}
        >
          <Icon name="security" />
          Security
        </button>
        {customer && (
          <button
            type="button"
            className={activeSettingsSection === 'verification' ? 'active' : ''}
            onClick={() => switchSettingsSection('verification')}
          >
            <Icon name="settings" />
            Verification
          </button>
        )}
      </nav>
      <form className="profile-form account-profile-form" onSubmit={saveProfile}>
        {activeSettingsSection === 'profile' && (
          <section className="settings-section" id="settings-personal">
            <div className="settings-section-heading">
              <span className="settings-icon">
                <Icon name="profile" />
              </span>
              <div>
                <h3>Profile</h3>
                <p>
                  {customer
                    ? 'Your name and national identity number.'
                    : user.role === 'rental_shop'
                      ? 'Your name and registered shop.'
                      : 'The name shown on your account.'}
                </p>
              </div>
              {editingProfileSection === 'profile' ? (
                <button type="button" className="settings-edit-button" onClick={cancelProfileEdit}>
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="settings-edit-button"
                  onClick={() => {
                    setEditingProfileSection('profile')
                    setProfileMessage('')
                    setProfileError('')
                  }}
                >
                  <Icon name="edit" /> Edit
                </button>
              )}
            </div>
            <div className="settings-fields">
              <label>
                Display name
                <input
                  value={profileUsername}
                  onChange={(event) => setProfileUsername(event.target.value)}
                  maxLength="50"
                  autoComplete="name"
                  readOnly={editingProfileSection !== 'profile'}
                  required
                />
              </label>
              {customer && (
                <label>
                  NIC verification
                  <input value={identityProfile?.maskedNic || 'Not submitted'} readOnly />
                  <button type="button" className="iv-back" onClick={openVerification}>
                    Manage identity verification →
                  </button>
                </label>
              )}
              {user.role === 'rental_shop' && (
                <label>
                  Registered shop name
                  <input value={user.shopName || 'Not set'} readOnly />
                  <small>Contact RentEase support to change your registered shop name.</small>
                </label>
              )}
            </div>
            {editingProfileSection === 'profile' && (
              <ProfileEditActions
                confirming={profileConfirmOpen}
                busy={busy}
                password={profilePassword}
                setPassword={setProfilePassword}
                onRequestSave={() => {
                  setProfileConfirmOpen(true)
                  setProfileError('')
                  setProfilePassword('')
                }}
                onCancelConfirm={() => {
                  setProfileConfirmOpen(false)
                  setProfileError('')
                  setProfilePassword('')
                }}
              />
            )}
          </section>
        )}
        {activeSettingsSection === 'contact' && (
          <section className="settings-section" id="settings-contact">
            <div className="settings-section-heading">
              <span className="settings-icon">
                <Icon name="contact" />
              </span>
              <div>
                <h3>Contact information</h3>
                <p>
                  {customer
                    ? 'Where we can reach you and where rentals should be delivered.'
                    : 'Where RentEase can reach you.'}
                </p>
              </div>
              {editingProfileSection === 'contact' ? (
                <button type="button" className="settings-edit-button" onClick={cancelProfileEdit}>
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="settings-edit-button"
                  onClick={() => {
                    setEditingProfileSection('contact')
                    setProfileMessage('')
                    setProfileError('')
                  }}
                >
                  <Icon name="edit" /> Edit
                </button>
              )}
            </div>
            <div className="settings-fields">
              <label>
                Contact phone
                <input
                  value={profilePhone}
                  onChange={(event) => setProfilePhone(event.target.value)}
                  maxLength="24"
                  autoComplete="tel"
                  readOnly={editingProfileSection !== 'contact'}
                  required
                />
              </label>
              <label>
                Email address
                <input
                  type="email"
                  value={profileEmail}
                  onChange={(event) => {
                    setProfileEmail(event.target.value)
                    setEmailOtp('')
                    setEmailOtpMessage('')
                  }}
                  autoComplete="email"
                  readOnly={editingProfileSection !== 'contact'}
                  required
                />
                {editingProfileSection === 'contact' &&
                  profileEmail.trim().toLowerCase() !== user.email?.toLowerCase() && (
                    <>
                      <button
                        type="button"
                        className="settings-secondary-button"
                        onClick={requestEmailOtp}
                        disabled={busy}
                      >
                        Send verification code to new email
                      </button>
                      {emailOtpMessage && (
                        <small className="settings-note">{emailOtpMessage}</small>
                      )}
                      <OtpInput label="New email verification code" value={emailOtp} onChange={setEmailOtp} disabled={busy} />
                    </>
                  )}
              </label>
              {customer && (
                <label className="settings-field-wide">
                  Default address
                  <input value={savedAddress} readOnly />
                  <button type="button" className="iv-back" onClick={openAddresses}>
                    Manage addresses securely →
                  </button>
                </label>
              )}
            </div>
            {editingProfileSection === 'contact' && (
              <ProfileEditActions
                confirming={profileConfirmOpen}
                busy={busy}
                password={profilePassword}
                setPassword={setProfilePassword}
                onRequestSave={() => {
                  setProfileConfirmOpen(true)
                  setProfileError('')
                  setProfilePassword('')
                }}
                onCancelConfirm={() => {
                  setProfileConfirmOpen(false)
                  setProfileError('')
                  setProfilePassword('')
                }}
              />
            )}
          </section>
        )}
        {['profile', 'contact'].includes(activeSettingsSection) && (
          <>
            {profileError && (
              <div className="market-alert error" role="alert">
                {profileError}
              </div>
            )}
            {profileMessage && (
              <div className="market-alert success" role="status">
                {profileMessage}
              </div>
            )}
          </>
        )}
      </form>
      {activeSettingsSection === 'security' && (
        <section className="settings-section password-settings-section" id="settings-security">
          <div className="settings-section-heading">
            <span className="settings-icon">
              <Icon name="security" />
            </span>
            <div>
              <h3>Security</h3>
              <p>Update your password and protect your account.</p>
            </div>
          </div>
          <form className="password-settings-form" onSubmit={savePassword}>
            <div className="settings-methods">
              <label>
                <input
                  type="radio"
                  name="password-auth-method"
                  checked={passwordAuthMethod === 'password'}
                  onChange={() => setPasswordAuthMethod('password')}
                />{' '}
                Current password
              </label>
              <label>
                <input
                  type="radio"
                  name="password-auth-method"
                  checked={passwordAuthMethod === 'otp'}
                  onChange={() => setPasswordAuthMethod('otp')}
                />{' '}
                Email code
              </label>
            </div>
            {passwordAuthMethod === 'password' ? (
              <label>
                Current password
                <input
                  type="password"
                  value={passwordCurrent}
                  onChange={(event) => setPasswordCurrent(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
            ) : (
              <div className="settings-code-entry">
                <button
                  type="button"
                  className="settings-secondary-button"
                  onClick={requestAccountOtp}
                  disabled={busy}
                >
                  Send code to account email
                </button>
                <OtpInput label="Password change verification code" value={passwordOtp} onChange={setPasswordOtp} disabled={busy} />
                {passwordOtpMessage && (
                  <small className="settings-note">{passwordOtpMessage}</small>
                )}
              </div>
            )}
            <div className="settings-fields">
              <label>
                New password
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength="10"
                  maxLength="128"
                  autoComplete="new-password"
                  required
                />
                <small>Use at least 10 characters.</small>
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(event) => setConfirmNewPassword(event.target.value)}
                  minLength="10"
                  maxLength="128"
                  autoComplete="new-password"
                  required
                />
              </label>
            </div>
            {passwordError && (
              <div className="market-alert error" role="alert">
                {passwordError}
              </div>
            )}
            {passwordMessage && (
              <div className="market-alert success" role="status">
                {passwordMessage}
              </div>
            )}
            <button className="checkout-submit settings-save-button" disabled={busy}>
              {busy ? 'Updating password…' : 'Update password'}
            </button>
          </form>
        </section>
      )}
      {customer && activeSettingsSection === 'verification' && (
        <IdentityStatusCard
          identity={identityProfile}
          onOpen={openVerification}
          onAddresses={openAddresses}
        />
      )}
    </dialog>
  )
}
