export default function ProfileEditActions({
  confirming,
  busy,
  password,
  setPassword,
  onRequestSave,
  onCancelConfirm,
}) {
  if (!confirming)
    return (
      <div className="profile-edit-actions">
        <span>Review your updates before saving.</span>
        <button type="button" className="checkout-submit" onClick={onRequestSave} disabled={busy}>
          Save changes
        </button>
      </div>
    )
  return (
    <div className="profile-confirm-box">
      <div>
        <span className="market-kicker">SECURITY CHECK</span>
        <h4>Confirm it’s you</h4>
        <p>Enter your current password to save these changes.</p>
      </div>
      <label>
        Current password
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          required
        />
      </label>
      <div className="profile-confirm-actions">
        <button
          type="button"
          className="settings-secondary-button"
          onClick={onCancelConfirm}
          disabled={busy}
        >
          Back
        </button>
        <button type="submit" className="checkout-submit" disabled={busy}>
          {busy ? 'Saving…' : 'Confirm and save'}
        </button>
      </div>
    </div>
  )
}
