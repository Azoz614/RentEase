// A reset request responds before looking up the account or contacting SMTP, so
// delivery time cannot reveal whether an address is registered. Node keeps these
// tasks alive naturally; the Durable Object pins them with waitUntil on Workers.
let schedule = (task) => { void task.catch(() => {}) }
export function configureAuthEmailTasks(provider) { schedule = provider }
export function deferAuthEmail(work) {
  const task = Promise.resolve().then(work).catch(() => {
    console.error('Password reset email could not be processed.')
  })
  schedule(task)
  return task
}
