import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { firstName } from '../lib/format'
import Logo from './Logo'

const COPY = {
  manager: {
    title: 'Your workplace is ready',
    points: [
      'Share your join code from Manage Team so your staff can sign up.',
      'Promote shift leads to Supervisor so they can see the Supervisors channel.',
      'Open Home before each shift and tap Refresh Summary for an AI shift brief.',
    ],
  },
  supervisor: {
    title: 'Welcome to the team',
    points: [
      'Post important news in Announcements. Everyone reads it, and only supervisors and managers can post there.',
      'The Supervisors channel is for shift leads and managers.',
      'Check Home before your shift for the latest shift brief.',
    ],
  },
  team_member: {
    title: 'Welcome to the team',
    points: [
      'Read Announcements for rota changes and news from your managers.',
      'Use General and Team Member to ask questions and share updates.',
      'Check Home before your shift to see what happened on the last one.',
    ],
  },
}

export default function WelcomeDialog() {
  const { profile, workplace, updateProfileLocal } = useAuth()
  const [saving, setSaving] = useState(false)
  const copy = COPY[profile.role] ?? COPY.team_member

  async function dismiss() {
    setSaving(true)
    await supabase.from('profiles').update({ has_onboarded: true }).eq('id', profile.id)
    updateProfileLocal({ has_onboarded: true })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="card w-full max-w-md p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <Logo className="h-12 w-12" />
        <h2 id="welcome-title" className="mt-4 text-xl font-bold text-navy-900">
          {copy.title}, {firstName(profile.display_name)}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          You're in <span className="font-medium text-slate-700">{workplace?.name}</span>. Here's how Handover keeps every shift on the same page.
        </p>
        <ul className="mt-5 space-y-3">
          {copy.points.map((p) => (
            <li key={p} className="flex gap-3 text-sm text-slate-700">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal-brand" />
              {p}
            </li>
          ))}
        </ul>
        <button className="btn-primary mt-6 w-full" onClick={dismiss} disabled={saving} autoFocus>
          Get Started
        </button>
      </div>
    </div>
  )
}
