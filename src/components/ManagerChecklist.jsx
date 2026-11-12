import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { CheckIcon } from './Icons'

const STEPS = [
  { key: 'staff_invited', title: 'Invite your staff', hint: 'Share your join code so your team can sign up.', to: '/settings/team', action: 'Get your join code' },
  { key: 'announcement_posted', title: 'Post your first announcement', hint: 'Say hello and tell the team how you\'ll use Handover.', to: '/channels/announcements', action: 'Write an announcement' },
  { key: 'notifications_on', title: 'Turn on notifications', hint: 'Get told about new messages on this phone.', to: '/settings/notifications', action: 'Turn on notifications' },
  { key: 'brief_refreshed', title: 'Refresh your first shift brief', hint: 'Tap Refresh Summary below once the team has posted a few updates.' },
]

// First-run checklist for managers. Each step ticks itself off from real activity.
export default function ManagerChecklist({ refreshKey }) {
  const { profile, updateProfileLocal } = useAuth()
  const [state, setState] = useState(null)

  useEffect(() => {
    supabase.rpc('manager_checklist').then(({ data }) => setState(data ?? null))
  }, [refreshKey, profile.workplace_id])

  if (!state || state.dismissed) return null
  const done = STEPS.filter((s) => state[s.key]).length
  if (done === STEPS.length) return null

  async function hide() {
    const at = new Date().toISOString()
    setState((s) => ({ ...s, dismissed: true }))
    updateProfileLocal({ checklist_dismissed_at: at })
    await supabase.from('profiles').update({ checklist_dismissed_at: at }).eq('id', profile.id)
  }

  return (
    <section className="card mb-6 p-5 sm:p-6" aria-labelledby="checklist-title" data-testid="manager-checklist">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="checklist-title" className="text-lg font-semibold text-navy-900">Get your venue set up</h2>
          <p className="mt-0.5 text-sm text-slate-500 tabular-nums">{done} of {STEPS.length} done</p>
        </div>
        <button onClick={hide} className="rounded-lg px-2 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700">Hide this list</button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full rounded-full bg-teal-brand transition-all" style={{ width: `${(done / STEPS.length) * 100}%` }} />
      </div>
      <ol className="mt-4 space-y-3">
        {STEPS.map((s) => {
          const complete = Boolean(state[s.key])
          return (
            <li key={s.key} className="flex gap-3" data-step={s.key} data-done={complete}>
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-inset ${complete ? 'bg-teal-brand text-white ring-teal-brand' : 'text-transparent ring-slate-300'}`}>
                <CheckIcon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${complete ? 'text-slate-400 line-through' : 'text-navy-900'}`}>
                  {s.title}<span className="sr-only">{complete ? ' (done)' : ' (to do)'}</span>
                </p>
                {!complete && (
                  <p className="mt-0.5 text-sm text-slate-500">
                    {s.hint}{' '}
                    {s.to && <Link to={s.to} className="font-semibold text-teal-dark hover:underline">{s.action}</Link>}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
