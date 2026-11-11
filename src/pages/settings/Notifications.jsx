import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { channelsFor } from '../../lib/constants'
import { disablePush, enablePush, pushStatus } from '../../lib/push'
import PageHeader from '../../components/PageHeader'
import Notice from '../../components/Notice'
import Spinner from '../../components/Spinner'
import { BellIcon } from '../../components/Icons'

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

const STATUS_TEXT = {
  on: 'On for this device. You will get a notification when someone posts in a channel you have switched on below.',
  off: 'Off for this device. Turn on to get a notification when someone posts, even when Handover is closed.',
  denied: 'Notifications are blocked for Handover in this browser. Allow them in your browser or phone settings for this site, then come back here.',
  'ios-install': 'On iPhone and iPad, Handover needs to be on your Home Screen before it can send notifications. See the steps below.',
  unsupported: 'This browser cannot receive push notifications. Try Chrome, Edge, Firefox or Safari.',
  'not-configured': 'Push notifications have not been set up for this workplace yet.',
}

function PushCard() {
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { pushStatus().then(setStatus) }, [])

  async function turnOn() {
    setBusy(true)
    setError('')
    try {
      setStatus(await enablePush())
    } catch {
      setError('Notifications could not be turned on. Check your connection and try again.')
      setStatus(await pushStatus())
    }
    setBusy(false)
  }

  async function turnOff() {
    setBusy(true)
    setError('')
    try {
      setStatus(await disablePush())
    } catch {
      setError('Notifications could not be turned off. Try again.')
    }
    setBusy(false)
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="push-title">
      <div className="flex flex-wrap items-start gap-4">
        <span className={`rounded-xl p-2.5 ${status === 'on' ? 'bg-teal-soft text-teal-dark' : 'bg-slate-100 text-slate-500'}`}>
          <BellIcon />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="push-title" className="font-semibold text-navy-900">Notifications on this device</h2>
          <p className="mt-1 text-sm text-slate-500" data-testid="push-status" data-status={status ?? 'loading'}>
            {status ? STATUS_TEXT[status] : 'Checking…'}
          </p>
        </div>
        {status === 'off' && (
          <button className="btn-primary" onClick={turnOn} disabled={busy}>
            {busy && <Spinner />} Turn on notifications
          </button>
        )}
        {status === 'on' && (
          <button className="btn-secondary" onClick={turnOff} disabled={busy}>
            {busy && <Spinner />} Turn off
          </button>
        )}
      </div>
      {error && <div className="mt-4"><Notice kind="error">{error}</Notice></div>}

      <div className={`mt-4 rounded-xl p-4 text-sm ring-1 ring-inset ${status === 'ios-install' ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-slate-50 text-slate-600 ring-slate-200'}`}>
        <p className="font-semibold">Using an iPhone or iPad?</p>
        <p className="mt-1">Push notifications only work after you add Handover to your Home Screen (iOS 16.4 or later):</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Open Handover in Safari.</li>
          <li>Tap the Share button, then <span className="font-medium">Add to Home Screen</span>.</li>
          <li>Open Handover from the new icon on your Home Screen.</li>
          <li>Come back to this page and tap <span className="font-medium">Turn on notifications</span>.</li>
        </ol>
      </div>
    </section>
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
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 lg:py-10">
      <PageHeader title="Notifications" subtitle="Get told about new messages, and choose which channels matter to you." />

      <PushCard />

      <section aria-labelledby="channels-title">
        <h2 id="channels-title" className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Channels</h2>
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
        <div className="mt-3 space-y-3">
          <Notice kind="error">{error}</Notice>
          <p className="text-xs text-slate-500">
            Channels you switch off won't send you notifications on any of your devices, and show a small grey dot for new messages instead of a count. You never get notified about your own messages.
          </p>
        </div>
      </section>
    </div>
  )
}
