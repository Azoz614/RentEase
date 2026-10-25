import { useEffect, useState } from 'react'

export function PrivateIdentityPhoto({ url, token, label }) {
  const [src, setSrc] = useState(''),
    [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl
    fetch(url, {
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error('Document unavailable. Contact support or request a replacement.')
        const blob = await response.blob()
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url, token])
  return (
    <figure className="iv-private-photo">
      {src ? (
        <img src={src} alt={label} />
      ) : (
        <p role={error ? 'alert' : 'status'}>{error || 'Loading private document…'}</p>
      )}
      <figcaption>{label} · restricted document</figcaption>
    </figure>
  )
}
