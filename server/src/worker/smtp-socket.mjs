import net from 'node:net'
import tls from 'node:tls'

// nodemailer resolves the SMTP host to an IP address and connects to that address,
// which Cloudflare's network refuses ("Connection closed unexpectedly"). Opening the
// socket by hostname works, so the Worker hands nodemailer ready-made sockets through
// its getSocket hook. Port 465 gets a TLS socket; on 587 nodemailer still upgrades
// the plain socket with STARTTLS itself.
export function smtpSocketByHostname(options, callback) {
  const { host, port, secure } = options
  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port })
  const ready = secure ? 'secureConnect' : 'connect'
  const started = Date.now()
  const fail = (error) => {
    console.error(`SMTP socket to ${host}:${port} failed after ${Date.now() - started}ms: ${error?.message}`)
    callback(error)
  }
  socket.once('error', fail)
  socket.once(ready, () => {
    socket.removeListener('error', fail)
    socket.once('close', () =>
      console.log(`SMTP socket to ${host}:${port} closed after ${Date.now() - started}ms`),
    )
    callback(null, { connection: socket, ...(secure && { secured: true }) })
  })
}
