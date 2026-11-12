import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { channelById } from '../lib/constants'
import Notice from './Notice'
import { XIcon } from './Icons'

const PAGE_NAMES = {
  '/': 'Home',
  '/settings/profile': 'My Profile',
  '/settings/notifications': 'Notifications',
  '/settings/account': 'Account',
  '/settings/help': 'Help & Support',
  '/settings/team': 'Manage Team',
  '/admin': 'Founder dashboard',
}

// A readable name for the screen someone was on, e.g. "Chat: General".
export function screenName(pathname) {
  const chat = pathname.match(/^\/channels\/([a-z_]+)/)
  if (chat) return `Chat: ${channelById(chat[1])?.name ?? chat[1]}`
  return PAGE_NAMES[pathname] ?? pathname
}

export default function FeedbackDialog({ onClose }) {
  const { pathname } = useLocation()
  const [screen] = useState(() => screenName(pathname))
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.rpc('submit_feedback', {
      p_screen: screen,
      p_message: message,
      p_app_version: __APP_VERSION__, // eslint-disable-line no-undef
      p_user_agent: navigator.userAgent,
    })
    setBusy(false)
    if (error) return setError(error.message || 'Your feedback was not sent. Check your connection and try again.')
    setSent(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <div className="card w-full max-w-md p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="feedback-title" className="text-lg font-semibold text-navy-900">Send feedback</h2>
          <button onClick={onClose} className="-mr-2 -mt-1 rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <XIcon />
          </button>
        </div>
        {sent ? (
          <div className="mt-3 space-y-4">
            <Notice kind="success">Thanks! Your feedback was sent to the Handover team.</Notice>
            <button className="btn-primary w-full" onClick={onClose} autoFocus>Done</button>
          </div>
        ) : (
          <form onSubmit={send} className="mt-2 space-y-3">
            <p className="text-sm text-slate-500">Tell us what's working, what's confusing or what's broken. We'll see which screen you're on ({screen}).</p>
            <label htmlFor="feedback-message" className="sr-only">Your feedback</label>
            <textarea
              id="feedback-message"
              rows={5}
              maxLength={2000}
              required
              autoFocus
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="input resize-none"
              placeholder="What would make Handover better for your shifts?"
            />
            <p className="text-xs text-slate-500">Please don't include passwords or guests' personal details.</p>
            {error && <Notice kind="error">{error}</Notice>}
            <button className="btn-primary w-full" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send feedback'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
