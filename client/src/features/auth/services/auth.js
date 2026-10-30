import { readJsonResponse } from '../../../services/http.js'

export async function authPost(path, body) {
  const result = await readJsonResponse(await fetch(`/api/auth/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), 'We could not complete this request.')
  return result.serverTime ? { ...result, receivedAt: Date.now() } : result
}

export function passwordError(password, confirmation) {
  if (password.length < 10 || password.length > 128 || new TextEncoder().encode(password).length > 72)
    return 'Use at least 10 characters and no more than 72 bytes for your password.'
  return password !== confirmation ? 'Your passwords do not match.' : ''
}

// Only short-lived registration state is saved; passwords and OTPs stay out of storage.
export const REGISTRATION_KEY = 'rentease.registration'
export function readRegistration() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(REGISTRATION_KEY) || 'null')
    return saved?.details?.email && saved?.challenge && new Date(saved.expiresAt).getTime() > Date.now() ? saved : null
  } catch { return null }
}
export function saveRegistration(value) {
  try {
    if (value) sessionStorage.setItem(REGISTRATION_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(REGISTRATION_KEY)
  } catch { /* Continue in memory when storage is unavailable. */ }
}
