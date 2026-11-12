// Usage counts for the pilot. Only "this person opened the app today" and
// "viewed the shift brief" are counted, per workplace. No content, no third parties.
import { supabase } from './supabase'

export function recordActivity(kind) {
  supabase.rpc('record_activity', { p_kind: kind }).then(() => {}, () => {})
}

// Count an app open at most once per day per browser session.
export function recordDailyOpen() {
  const key = `handover:opened:${new Date().toDateString()}`
  try {
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
  } catch { /* storage unavailable: count anyway */ }
  recordActivity('open')
}
