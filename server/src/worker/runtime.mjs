// Workers-specific configuration helpers. No `cloudflare:*` imports, so these are
// unit tested under Node.

// Workers already mirror string bindings into process.env (nodejs_compat); copying
// them explicitly keeps the existing process.env-based configuration independent
// of that compatibility flag.
export function populateProcessEnv(env) {
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string') process.env[key] = value
}

// One Durable Object serves every API request, so it keeps a small pool open to
// Atlas. Workers allow only six outbound connections in flight at once and the
// driver keeps one monitoring socket per replica-set member (three on Atlas), so a
// larger pool deadlocks startup: polling monitors (3) + pool (2) leaves a slot free
// for R2, fetch and SMTP.
export function mongoOptions(env) {
  const poolSize = Number(env.MONGO_MAX_POOL_SIZE)
  return {
    appName: 'rentease-workers',
    maxPoolSize: Number.isInteger(poolSize) && poolSize > 0 ? poolSize : 2,
    minPoolSize: 0,
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 10_000,
    serverMonitoringMode: 'poll',
  }
}

// Must match the crons in wrangler.jsonc character for character.
export const DISPATCH_CRON = '*/5 * * * *'
export const RETENTION_CRON = '30 20 * * *'

export const retentionMode = (env) => (env.IDENTITY_RETENTION_PURGE === 'apply' ? 'apply' : 'dry-run')
