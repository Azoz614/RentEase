export function uploadIdentity(body, token, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/identity/submit')
    xhr.setRequestHeader('Content-Type', 'application/json')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.timeout = 60000
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onerror = () =>
      reject(new Error('The upload could not reach the server. Please try again.'))
    xhr.ontimeout = () =>
      reject(new Error('The upload timed out. Check your connection and try again.'))
    xhr.onload = () => {
      let result
      try {
        result = JSON.parse(xhr.responseText)
      } catch {
        reject(new Error('The server returned an invalid response.'))
        return
      }
      if (xhr.status < 200 || xhr.status >= 300)
        reject(
          Object.assign(new Error(result.message || 'Identity submission failed.'), {
            code: result.code,
          }),
        )
      else resolve(result)
    }
    xhr.send(JSON.stringify(body))
  })
}
