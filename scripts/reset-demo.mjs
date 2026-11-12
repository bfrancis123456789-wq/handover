// Resets the sales demo workspace with one command:
//   npm run demo:reset                       (local stack, after `supabase start`)
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run demo:reset
// Keep the service role key out of the repo and out of chat.
import { execSync } from 'node:child_process'

let url = process.env.SUPABASE_URL
let key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  try {
    const env = execSync('supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    url ||= env.match(/^API_URL="?([^"\n]+)"?/m)?.[1]
    key ||= env.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?/m)?.[1]
  } catch { /* not running locally */ }
}
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or start the local stack with `supabase start`.')
  process.exit(1)
}

const endpoint = process.env.RESET_DEMO_URL || `${url.replace(/\/$/, '')}/functions/v1/reset-demo`
const res = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' })
const body = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error(`Demo reset failed (${res.status}): ${body.error ?? 'no details'}`)
  process.exit(1)
}
console.log(`Demo workspace reset with ${body.messages} messages.`)
console.log(`Sign in with any of these, password "${body.password}":`)
for (const a of body.accounts) console.log(`  ${a}`)
