import mongoose from 'mongoose'
import { pathToFileURL } from 'node:url'
import { purgeIdentityDocuments } from '../src/modules/identity/identity-retention.service.mjs'

export { purgeIdentityDocuments }

// Purges documents kept on the local disk store. On Cloudflare the Worker's daily
// cron runs the same purge against R2 (see IDENTITY_RETENTION_PURGE in wrangler.jsonc).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('dotenv/config')
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    console.log(
      JSON.stringify(
        await purgeIdentityDocuments({ apply: process.argv.includes('--apply') }),
        null,
        2,
      ),
    )
  } catch (error) {
    console.error(
      `Document retention maintenance failed (${error.name}). Check private storage and database permissions.`,
    )
    process.exitCode = 1
  } finally {
    await mongoose.disconnect()
  }
}
