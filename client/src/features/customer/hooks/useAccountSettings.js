import { useState } from 'react'

export default function useAccountSettings({
  user,
  api,
  savedAddress,
  setBusy,
  onAccountUpdate,
  onProfileSaved,
  onRestoreContact,
}) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)

  const [activeSettingsSection, setActiveSettingsSection] = useState('profile')

  const [profileError, setProfileError] = useState('')

  const [profileMessage, setProfileMessage] = useState('')

  const [profileUsername, setProfileUsername] = useState(user.username || '')

  const [profileEmail, setProfileEmail] = useState(user.email || '')

  const [profilePhone, setProfilePhone] = useState(user.phone || '')

  const [profilePassword, setProfilePassword] = useState('')

  const [editingProfileSection, setEditingProfileSection] = useState('')

  const [profileConfirmOpen, setProfileConfirmOpen] = useState(false)

  const [emailOtp, setEmailOtp] = useState('')

  const [emailOtpMessage, setEmailOtpMessage] = useState('')

  const [passwordAuthMethod, setPasswordAuthMethod] = useState('password')

  const [passwordCurrent, setPasswordCurrent] = useState('')

  const [passwordOtp, setPasswordOtp] = useState('')

  const [passwordOtpMessage, setPasswordOtpMessage] = useState('')

  const [newPassword, setNewPassword] = useState('')

  const [confirmNewPassword, setConfirmNewPassword] = useState('')

  const [passwordError, setPasswordError] = useState('')

  const [passwordMessage, setPasswordMessage] = useState('')

  const requestAccountOtp = async () => {
    setPasswordOtpMessage('')
    setBusy(true)
    try {
      const result = await api('/api/account/otp/send', {
        method: 'POST',
        body: JSON.stringify({ purpose: 'password_change' }),
      })
      setPasswordOtpMessage(result.message)
    } catch (otpError) {
      setPasswordOtpMessage(otpError.message)
    } finally {
      setBusy(false)
    }
  }

  const requestEmailOtp = async () => {
    setEmailOtpMessage('')
    setBusy(true)
    try {
      const result = await api('/api/account/email-otp/send', {
        method: 'POST',
        body: JSON.stringify({ email: profileEmail }),
      })
      setEmailOtpMessage(result.message)
    } catch (otpError) {
      setEmailOtpMessage(otpError.message)
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = async (event) => {
    event.preventDefault()
    setProfileError('')
    setProfileMessage('')
    setBusy(true)
    try {
      const result = await api('/api/account/profile', {
        method: 'PUT',
        body: JSON.stringify({
          username: profileUsername,
          email: profileEmail,
          phone: profilePhone,
          address: savedAddress,
          password: profilePassword,
          emailOtp,
        }),
      })
      onProfileSaved(result)
      setProfilePassword('')
      setEmailOtp('')
      setProfileConfirmOpen(false)
      setEditingProfileSection('')
      setProfileMessage(result.message)
      onAccountUpdate?.(result.user)
    } catch (saveError) {
      setProfileError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  const cancelProfileEdit = () => {
    setEditingProfileSection('')
    setProfileConfirmOpen(false)
    setProfileError('')
    setProfilePassword('')
    setEmailOtp('')
    setEmailOtpMessage('')
    setProfileUsername(user.username || '')
    setProfileEmail(user.email || '')
    setProfilePhone(user.phone || '')
    onRestoreContact()
  }

  const savePassword = async (event) => {
    event.preventDefault()
    setPasswordError('')
    setPasswordMessage('')
    if (newPassword !== confirmNewPassword) {
      setPasswordError('The new passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await api('/api/account/password', {
        method: 'PUT',
        body: JSON.stringify({
          newPassword,
          ...(passwordAuthMethod === 'password'
            ? { password: passwordCurrent }
            : { verificationOtp: passwordOtp }),
        }),
      })
      setPasswordMessage(result.message)
      setPasswordCurrent('')
      setPasswordOtp('')
      setNewPassword('')
      setConfirmNewPassword('')
    } catch (saveError) {
      setPasswordError(saveError.message)
    } finally {
      setBusy(false)
    }
  }

  const switchSettingsSection = (section) => {
    if (editingProfileSection) cancelProfileEdit()
    setActiveSettingsSection(section)
    setProfileError('')
    setProfileMessage('')
    setPasswordError('')
    setPasswordMessage('')
    requestAnimationFrame(() =>
      document.getElementById('profile-settings')?.scrollTo({ top: 0, behavior: 'smooth' }),
    )
  }

  const openProfileSettings = (section = 'profile') => {
    setProfileMenuOpen(false)
    setActiveSettingsSection(section)
    setEditingProfileSection('')
    setProfileConfirmOpen(false)
    setProfileError('')
    setProfileMessage('')
    setPasswordError('')
    setPasswordMessage('')
    setEmailOtpMessage('')
    setPasswordOtpMessage('')
    setEmailOtp('')
    setPasswordOtp('')
    setProfilePassword('')
    setPasswordCurrent('')
    setProfileUsername(user.username || '')
    setProfileEmail(user.email || '')
    setProfilePhone(user.phone || '')
    onRestoreContact()
    const dialog = document.getElementById('profile-settings')
    if (!dialog?.open) dialog?.showModal()
    requestAnimationFrame(() => dialog?.scrollTo({ top: 0, behavior: 'auto' }))
  }

  return {
    profileMenuOpen,
    setProfileMenuOpen,
    activeSettingsSection,
    setActiveSettingsSection,
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
    setPasswordOtpMessage,
    newPassword,
    setNewPassword,
    confirmNewPassword,
    setConfirmNewPassword,
    passwordError,
    setPasswordError,
    passwordMessage,
    setPasswordMessage,
    requestAccountOtp,
    requestEmailOtp,
    saveProfile,
    cancelProfileEdit,
    savePassword,
    switchSettingsSection,
    openProfileSettings,
  }
}
