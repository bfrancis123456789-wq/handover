import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { channelsFor } from '../../lib/constants'
import PageHeader from '../../components/PageHeader'
import Notice from '../../components/Notice'

function Toggle({ id, checked, onChange, label }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-brand ${checked ? 'bg-teal-brand' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  )
}

export default function Notifications() {
  const { profile, updateProfileLocal } = useAuth()
  const [error, setError] = useState('')
  const settings = profile.notification_settings ?? {}

  async function set(channelId, value) {
    const next = { ...settings, [channelId]: value }
    updateProfileLocal({ notification_settings: next })
    setError('')
    const { error } = await supabase.from('profiles').update({ notification_settings: next }).eq('id', profile.id)
    if (error) {
      updateProfileLocal({ notification_settings: settings })
      setError('That change was not saved. Try again.')
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:py-10">
      <PageHeader title="Notifications" subtitle="Choose which channels you want to hear about. Saved to your profile." />
      <div className="card divide-y divide-slate-100">
        {channelsFor(profile.role).map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-4 p-4 sm:px-6">
            <div className="min-w-0">
              <p className="font-medium text-navy-900">{c.name}</p>
              <p className="text-sm text-slate-500">{c.blurb}</p>
            </div>
            <Toggle id={`notify-${c.id}`} label={`Notifications for ${c.name}`} checked={settings[c.id] !== false} onChange={(v) => set(c.id, v)} />
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <Notice kind="error">{error}</Notice>
        <p className="text-xs text-slate-500">Push notifications to your phone are coming later. Your choices here will be used when they arrive.</p>
      </div>
    </div>
  )
}
