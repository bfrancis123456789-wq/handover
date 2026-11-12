import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { messageTime } from '../lib/format'
import Logo from '../components/Logo'
import Notice from '../components/Notice'
import Spinner from '../components/Spinner'

// Claude Haiku 5.5 list prices (USD per million tokens), for a rough cost per venue.
const PRICE_IN = 0.1
const PRICE_OUT = 0.5
const cost = (inp, out) => (Number(inp) * PRICE_IN + Number(out) * PRICE_OUT) / 1_000_000
const usd = (n) => (n < 0.01 && n > 0 ? '< US$0.01' : `US$${n.toFixed(2)}`)
const pct = (a, b) => (Number(b) ? `${Math.round((Number(a) / Number(b)) * 100)}%` : '–')

function Shell({ children }) {
  return (
    <div className="min-h-full bg-canvas">
      <header className="bg-navy-900 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <span className="flex items-center gap-3"><Logo withText className="h-8 w-8" /><span className="hidden text-sm text-slate-400 sm:inline">Founder dashboard</span></span>
          <Link to="/" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-navy-800">Back to Handover</Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">{children}</main>
    </div>
  )
}

// Two-factor sign-in: set up an authenticator app once, then enter a code each session.
function TwoFactor({ onDone }) {
  const [factor, setFactor] = useState(null) // { id, qr, secret, isNew }
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    // Run setup once, even if the effect runs twice (React development mode),
    // so two setups can't race and cancel each other.
    if (started.current) return
    started.current = true
    ;(async () => {
      const { data } = await supabase.auth.mfa.listFactors()
      const verified = data?.totp?.find((f) => f.status === 'verified')
      if (verified) return setFactor({ id: verified.id, isNew: false })
      // Remove any half-finished setup, then start a fresh one.
      for (const f of data?.all ?? []) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
      const { data: enrolled, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Handover admin ${Date.now()}` })
      if (error) return setError('Two-factor setup could not start. Reload the page and try again.')
      setFactor({ id: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret, isNew: true })
    })()
  }, [])

  async function verify(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() })
    setBusy(false)
    if (error) return setError('That code didn\'t work. Check the time on your phone and enter the newest code.')
    onDone()
  }

  return (
    <div className="card mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold text-navy-900">{factor && !factor.isNew ? 'Enter your sign-in code' : 'Set up two-factor sign-in'}</h1>
      {!factor ? (
        !error && <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-teal-brand" /></div>
      ) : (
        <form onSubmit={verify} className="mt-3 space-y-4">
          {factor.isNew && (
            <>
              <p className="text-sm text-slate-600">This dashboard shows every venue, so it needs a code from an authenticator app (Google Authenticator, 1Password, Authy). Scan this with the app:</p>
              <img src={factor.qr} alt="QR code for your authenticator app" className="mx-auto h-44 w-44 rounded-lg bg-white p-2 ring-1 ring-slate-200" />
              <p className="text-xs text-slate-500">Can't scan? Enter this key: <code className="select-all break-all rounded bg-slate-100 px-1" data-testid="totp-secret">{factor.secret}</code></p>
            </>
          )}
          {!factor.isNew && <p className="text-sm text-slate-600">Open your authenticator app and enter the 6-digit code for Handover.</p>}
          <div>
            <label htmlFor="totp-code" className="label">6-digit code</label>
            <input id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className="input text-center font-mono text-lg tracking-[0.3em]"
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </div>
          {error && <Notice kind="error">{error}</Notice>}
          <button className="btn-primary w-full" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Continue'}</button>
        </form>
      )}
      {!factor && error && <div className="mt-3"><Notice kind="error">{error}</Notice></div>}
    </div>
  )
}

function Metric({ label, value, sub }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-navy-900">{value}</dd>
      {sub && <dd className="text-xs text-slate-400 tabular-nums">{sub}</dd>}
    </div>
  )
}

function CapEditor({ venue, onSaved }) {
  const [value, setValue] = useState(String(venue.daily_ai_cap))
  const [state, setState] = useState('')
  async function save(e) {
    e.preventDefault()
    setState('saving')
    const { error } = await supabase.rpc('admin_set_ai_cap', { p_workplace: venue.workplace_id, p_cap: Number(value) })
    setState(error ? error.message : 'saved')
    if (!error) onSaved()
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`cap-${venue.workplace_id}`} className="text-xs text-slate-500">Daily brief limit</label>
      <input id={`cap-${venue.workplace_id}`} type="number" min="0" max="10000" className="input w-24 py-1.5 text-sm" value={value} onChange={(e) => { setValue(e.target.value); setState('') }} />
      <button className="btn-secondary px-3 py-1.5 text-xs" disabled={state === 'saving' || value === String(venue.daily_ai_cap)}>Save</button>
      {state && state !== 'saving' && <span className={`text-xs ${state === 'saved' ? 'text-emerald-700' : 'text-red-700'}`}>{state === 'saved' ? 'Saved' : state}</span>}
    </form>
  )
}

function VenueCard({ v, onChanged }) {
  const venueCost = cost(v.input_tokens_7d, v.output_tokens_7d)
  return (
    <article className="card p-5" data-testid="venue" data-venue={v.name}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-navy-900">{v.name}</h3>
          <p className="text-xs text-slate-500">Joined {new Date(v.created_at).toLocaleDateString()}</p>
        </div>
        {v.is_demo && <span className="rounded-full bg-teal-soft px-2 py-0.5 text-xs font-semibold text-teal-dark">Demo</span>}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Metric label="Active this week" value={`${v.active_7d} / ${v.members}`} sub={`Last week: ${v.active_prev_7d}`} />
        <Metric label="Messages (7 days)" value={v.messages_7d} sub={`${v.messages_total} in total`} />
        <Metric label="Briefs viewed (7 days)" value={v.brief_views_7d} sub={`${v.brief_refreshes_7d} refreshed`} />
        <Metric label="Open issues" value={v.issues_open} sub={`${v.issues_resolved_7d} resolved this week`} />
        <Metric label="Shift reports (7 days)" value={v.reports_7d ?? 0} />
        <Metric label="Push opt-in" value={pct(v.push_opted_in, v.members)} sub={`${v.push_opted_in} of ${v.members} people`} />
        <Metric label="AI cost (7 days)" value={usd(venueCost)} sub={`${v.ai_calls_today} of ${v.daily_ai_cap} briefs today`} />
      </dl>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <CapEditor venue={v} onSaved={onChanged} />
        {v.feedback_7d > 0 && <span className="text-xs text-slate-500">{v.feedback_7d} feedback this week</span>}
      </div>
    </article>
  )
}

function DemoReset({ onDone }) {
  const [confirming, setConfirming] = useState(false)
  const [state, setState] = useState({ kind: 'success', text: '' })
  const [busy, setBusy] = useState(false)
  async function reset() {
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('reset-demo', { body: {} })
    setBusy(false)
    setConfirming(false)
    if (error) {
      let text = 'The demo could not be reset. Try again in a moment.'
      try { text = (await error.context.json()).error || text } catch { /* keep default */ }
      return setState({ kind: 'error', text })
    }
    setState({ kind: 'success', text: `Demo reset. Sign in as demo.manager@demo.handover.test with "${data.password}".` })
    onDone()
  }
  return (
    <section className="card p-5" aria-labelledby="demo-title">
      <h2 id="demo-title" className="font-semibold text-navy-900">Demo workspace</h2>
      <p className="mt-1 text-sm text-slate-500">Wipes Harbour Hotel (Demo) and fills it with fresh sample data. Demo passwords are reset too. No other venue is touched.</p>
      <div className="mt-3 space-y-3">
        <Notice kind={state.kind}>{state.text}</Notice>
        {!confirming ? (
          <button className="btn-secondary" onClick={() => setConfirming(true)}>Reset demo</button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
            <p className="w-full text-sm text-amber-900 sm:w-auto sm:flex-1">Reset the demo now? Anyone using it will see the sample data change.</p>
            <button className="btn-primary px-3 py-1.5 text-xs" onClick={reset} disabled={busy}>{busy ? 'Resetting…' : 'Yes, reset demo'}</button>
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
          </div>
        )}
      </div>
    </section>
  )
}

export default function AdminDashboard() {
  const [status, setStatus] = useState(null)
  const [venues, setVenues] = useState(null)
  const [feedback, setFeedback] = useState([])
  const [error, setError] = useState('')

  const loadStatus = useCallback(async () => {
    const { data } = await supabase.rpc('my_admin_status')
    setStatus(data ?? { admin: false, mfa: false })
  }, [])

  const loadData = useCallback(async () => {
    const [s, f] = await Promise.all([supabase.rpc('admin_workplace_stats'), supabase.rpc('admin_recent_feedback', { p_limit: 50 })])
    if (s.error) return setError('The numbers could not be loaded. Reload the page to try again.')
    setVenues(s.data ?? [])
    setFeedback(f.data ?? [])
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])
  useEffect(() => { if (status?.admin && status?.mfa) loadData() }, [status, loadData])

  if (!status) return <Shell><div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-teal-brand" /></div></Shell>
  if (!status.admin) {
    return <Shell><div className="card mx-auto max-w-md p-6 text-center"><h1 className="text-lg font-semibold text-navy-900">This page is for the Handover team</h1><p className="mt-2 text-sm text-slate-500">Your account doesn't have access to the founder dashboard.</p></div></Shell>
  }
  if (!status.mfa) {
    return <Shell><TwoFactor onDone={async () => { await supabase.auth.refreshSession(); loadStatus() }} /></Shell>
  }

  const real = (venues ?? []).filter((v) => !v.is_demo)
  const sum = (k) => real.reduce((n, v) => n + Number(v[k]), 0)
  const totalCost = real.reduce((n, v) => n + cost(v.input_tokens_7d, v.output_tokens_7d), 0)

  return (
    <Shell>
      <h1 className="text-2xl font-bold tracking-tight text-navy-900">Pilot venues</h1>
      <p className="mt-1 text-sm text-slate-500">Counts only. No names or messages are shown. Weeks are the last 7 days, Sydney time.</p>
      {error && <div className="mt-4"><Notice kind="error">{error}</Notice></div>}
      {!venues ? (
        <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-teal-brand" /></div>
      ) : (
        <>
          <dl className="card mt-6 grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-7" data-testid="totals">
            <Metric label="Venues" value={real.length} />
            <Metric label="Active this week" value={`${sum('active_7d')} / ${sum('members')}`} />
            <Metric label="Messages (7 days)" value={sum('messages_7d')} />
            <Metric label="Briefs viewed (7 days)" value={sum('brief_views_7d')} />
            <Metric label="Shift reports (7 days)" value={sum('reports_7d')} />
            <Metric label="Push opt-in" value={pct(sum('push_opted_in'), sum('members'))} />
            <Metric label="AI cost (7 days)" value={usd(totalCost)} />
          </dl>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {venues.map((v) => <VenueCard key={v.workplace_id} v={v} onChanged={loadData} />)}
            {venues.length === 0 && <p className="text-sm text-slate-500">No venues yet.</p>}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <section className="card p-5" aria-labelledby="feedback-title">
              <h2 id="feedback-title" className="font-semibold text-navy-900">Latest feedback</h2>
              {feedback.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No feedback yet. Staff can send it from Send feedback in the menu.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100">
                  {feedback.map((f, i) => (
                    <li key={i} className="py-3" data-testid="feedback-item">
                      <p className="flex flex-wrap gap-x-2 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">{f.workplace}</span>
                        <span>{f.screen}</span>
                        <span>{messageTime(f.created_at)}</span>
                        {f.app_version && <span>v{f.app_version}</span>}
                        {f.is_demo && <span className="text-teal-dark">demo</span>}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800">{f.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <DemoReset onDone={loadData} />
          </div>
        </>
      )}
    </Shell>
  )
}
