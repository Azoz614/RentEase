export const SESSION_KEY = 'rentease.session.v1'

export function readSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    return saved?.token && saved?.user ? saved : null
  } catch {
    return null
  }
}
