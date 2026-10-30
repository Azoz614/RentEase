let library
export function loadGoogleIdentity() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  library ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true
    const timeout = setTimeout(() => { script.remove(); library = null; reject(new Error('Google sign-in did not load. Check your connection and try again.')) }, 12000)
    script.onload = () => {
      clearTimeout(timeout)
      if (window.google?.accounts?.id) resolve(window.google.accounts.id)
      else { library = null; reject(new Error('Google sign-in is unavailable in this browser.')) }
    }
    script.onerror = () => { clearTimeout(timeout); script.remove(); library = null; reject(new Error('Google sign-in could not load. Please try again.')) }
    document.head.append(script)
  })
  return library
}
