import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatCount, useUnread } from '../context/UnreadContext'
import { supabase } from '../lib/supabase'
import { channelsFor } from '../lib/constants'
import { firstName, greeting, longDate, messageTime } from '../lib/format'
import Notice from '../components/Notice'
import Spinner from '../components/Spinner'
import { CopyIcon, HashIcon, LockIcon, RefreshIcon } from '../components/Icons'

const SECTIONS = [
  { key: 'critical_issues', title: 'Critical Issues', dot: 'bg-red-500', tint: 'bg-red-50', text: 'text-red-700', empty: 'No critical issues reported.' },
  { key: 'ongoing_items', title: 'Ongoing Items', dot: 'bg-amber-500', tint: 'bg-amber-50', text: 'text-amber-700', empty: 'Nothing in progress.' },
  { key: 'resolved_today', title: 'Resolved Today', dot: 'bg-emerald-500', tint: 'bg-emerald-50', text: 'text-emerald-700', empty: 'Nothing marked as resolved.' },
  { key: 'next_priority', title: 'Next Priority', dot: 'bg-blue-500', tint: 'bg-blue-50', text: 'text-blue-700', empty: 'No priorities set.' },
]

function briefAsText(content, workplaceName, when) {
  const lines = [`Shift brief for ${workplaceName} (${when})`]
  for (const s of SECTIONS) {
    const items = content[s.key] ?? []
    lines.push('', s.title.toUpperCase())
    lines.push(...(items.length ? items.map((i) => `- ${i}`) : [`- ${s.empty}`]))
  }
  return lines.join('\n')
}

async function readFunctionError(error) {
  try {
    const body = await error.context.json()
    if (body?.error) return body.error
  } catch { /* fall through */ }
  return 'The brief could not be refreshed. Check your connection and try again.'
}

function BriefSection({ section, items }) {
  return (
    <section className={`rounded-xl p-4 ${section.tint}`}>
      <h3 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] ${section.text}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${section.dot}`} />
        {section.title}
        {items.length > 0 && <span className="ml-auto tabular-nums">{items.length}</span>}
      </h3>
      {items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-800">
              <span className={`mt-2 h-1 w-1 shrink-0 rounded-full ${section.dot}`} />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-slate-500">{section.empty}</p>
      )}
    </section>
  )
}

export default function Home() {
  const { profile, workplace } = useAuth()
  const { counts } = useUnread()
  const [copied, setCopied] = useState(false)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let active = true
    supabase
      .from('summaries')
      .select('id, content, created_at')
      .eq('user_id', profile.id)
      .eq('workplace_id', profile.workplace_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        setSummary(data)
        setLoading(false)
      })
    return () => { active = false }
  }, [profile.id, profile.workplace_id])

  async function refreshSummary() {
    setError('')
    setInfo('')
    setRefreshing(true)
    const { data, error } = await supabase.functions.invoke('shift-brief', { method: 'POST' })
    setRefreshing(false)
    if (error) return setError(await readFunctionError(error))
    if (data?.empty) return setInfo('No messages in the last 24 hours, so there is nothing to summarise yet. Post an update and try again.')
    if (data?.summary) setSummary(data.summary)
    if (data?.unchanged) setInfo('Already up to date. Nothing new has been posted since this brief was written.')
    if (data?.cooldown) setInfo(`This brief was refreshed moments ago. You can refresh again in ${data.retry_after} seconds.`)
  }

  async function copyBrief() {
    const text = briefAsText(summary.content, workplace?.name ?? 'your workplace', messageTime(summary.created_at))
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copy did not work in this browser.')
    }
  }

  const content = summary?.content

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-10">
      <div className="mb-6">
        <p className="text-sm font-medium text-teal-dark">{longDate(now)}</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-900 text-balance sm:text-3xl">
          {greeting(now)}, {firstName(profile.display_name)}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{workplace?.name}</p>
      </div>

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-navy-900">Your Shift Brief</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {content
                ? `Updated ${messageTime(summary.created_at)}${content.message_count ? ` from ${content.message_count} message${content.message_count === 1 ? '' : 's'}` : ''}`
                : 'A summary of the last 24 hours across your channels.'}
            </p>
            {content?.channels && <p className="mt-0.5 text-xs text-slate-400">Covers {content.channels.join(', ')}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {content && (
              <button className="btn-secondary" onClick={copyBrief}>
                <CopyIcon className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <button className="btn-primary" onClick={refreshSummary} disabled={refreshing}>
              {refreshing ? <Spinner /> : <RefreshIcon className="h-4 w-4" />}
              {refreshing ? 'Summarising…' : 'Refresh Summary'}
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <Notice kind="error">{error}</Notice>
          <Notice kind="info">{info}</Notice>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Spinner className="h-6 w-6 text-teal-brand" /></div>
        ) : content ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {SECTIONS.map((s) => <BriefSection key={s.key} section={s} items={content[s.key] ?? []} />)}
          </div>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
            <p className="font-medium text-slate-700">No brief yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
              Tap Refresh Summary to turn the last 24 hours of messages into critical issues, ongoing items and priorities.
            </p>
          </div>
        )}
      </div>

      <h2 className="mb-3 mt-8 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Your channels</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {channelsFor(profile.role).map((c) => {
          const Icon = c.roles.length < 3 ? LockIcon : HashIcon
          return (
            <Link key={c.id} to={`/channels/${c.id}`} className="card flex items-start gap-3 p-4 transition hover:ring-teal-brand/50">
              <span className="rounded-lg bg-teal-soft p-2 text-teal-dark"><Icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-semibold text-navy-900">
                  {c.name}
                  {counts[c.id] > 0 && (
                    <span className="rounded-full bg-teal-brand px-2 py-0.5 text-[11px] font-bold leading-none text-white tabular-nums">{formatCount(counts[c.id])} new</span>
                  )}
                </span>
                <span className="block text-sm text-slate-500">{c.blurb}</span>
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
