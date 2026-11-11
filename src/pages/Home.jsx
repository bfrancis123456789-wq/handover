import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { formatCount, useUnread } from '../context/UnreadContext'
import { supabase } from '../lib/supabase'
import { canAccess, channelById, channelsFor } from '../lib/constants'
import { firstName, greeting, issueAge, longDate, messageTime } from '../lib/format'
import Notice from '../components/Notice'
import Spinner from '../components/Spinner'
import { CopyIcon, HashIcon, LockIcon, RefreshIcon } from '../components/Icons'

const DAY = 24 * 60 * 60 * 1000
const ISSUE_SELECT =
  'id, channel, title, severity, status, created_at, resolved_at, owner_id, owner:profiles!issues_owner_id_fkey(display_name), resolver:profiles!issues_resolved_by_fkey(display_name)'

const STYLES = {
  red: { dot: 'bg-red-500', tint: 'bg-red-50', text: 'text-red-700' },
  amber: { dot: 'bg-amber-500', tint: 'bg-amber-50', text: 'text-amber-700' },
  green: { dot: 'bg-emerald-500', tint: 'bg-emerald-50', text: 'text-emerald-700' },
  blue: { dot: 'bg-blue-500', tint: 'bg-blue-50', text: 'text-blue-700' },
}

async function readFunctionError(error) {
  try {
    const body = await error.context.json()
    if (body?.error) return body.error
  } catch { /* fall through */ }
  return 'The brief could not be refreshed. Check your connection and try again.'
}

function Section({ title, color, count, testId, children }) {
  const s = STYLES[color]
  return (
    <section className={`min-w-0 rounded-xl p-4 ${s.tint}`} data-testid={testId}>
      <h3 className={`flex items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] ${s.text}`}>
        <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
        {title}
        {count > 0 && <span className="ml-auto tabular-nums">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

const Empty = ({ children }) => <p className="mt-3 text-sm text-slate-500">{children}</p>

function IssueItem({ issue, color, canManage, members, onAction }) {
  const [busy, setBusy] = useState(false)
  const channel = channelById(issue.channel)
  const resolved = issue.status === 'resolved'
  const eligible = members.filter((m) => canAccess(issue.channel, m.role))

  async function run(kind, value) {
    setBusy(true)
    await onAction(kind, issue, value)
    setBusy(false)
  }

  return (
    <li className="rounded-lg bg-white/70 p-3 ring-1 ring-black/5" data-issue-id={issue.id} data-status={issue.status}>
      <div className="flex gap-2">
        <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${STYLES[color].dot}`} />
        <p className="min-w-0 text-sm font-medium leading-relaxed text-slate-900">{issue.title}</p>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-3.5 text-xs text-slate-500">
        {resolved ? (
          <span>Resolved {messageTime(issue.resolved_at)} {issue.resolver ? `by ${issue.resolver.display_name}` : 'from the chat'}</span>
        ) : (
          <span className={`rounded-full px-2 py-0.5 font-semibold ${STYLES[color].text} bg-white ring-1 ring-inset ring-current/20`} data-testid="issue-age">
            {issueAge(issue.created_at)}
          </span>
        )}
        {channel && <span>#{channel.name}</span>}
        {!resolved && <span data-testid="issue-owner">{issue.owner ? `Owner: ${issue.owner.display_name}` : 'No owner'}</span>}
      </p>
      {canManage && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-3.5">
          {!resolved ? (
            <>
              <label htmlFor={`owner-${issue.id}`} className="sr-only">Owner for {issue.title}</label>
              <select
                id={`owner-${issue.id}`}
                value={issue.owner_id ?? ''}
                disabled={busy}
                onChange={(e) => run('assign', e.target.value || null)}
                className="input w-auto max-w-full py-1.5 pr-8 text-xs"
              >
                <option value="">No owner</option>
                {eligible.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
              <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={() => run('resolve')}>
                {busy ? <Spinner className="h-3.5 w-3.5" /> : null} Mark resolved
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" disabled={busy} onClick={() => run('reopen')}>Reopen</button>
          )}
        </div>
      )}
    </li>
  )
}

function briefAsText({ critical, ongoing, resolvedToday, priorities }, workplaceName) {
  const list = (items, fmt) => (items.length ? items.map((i) => `- ${fmt(i)}`) : ['- Nothing'])
  return [
    `Shift brief for ${workplaceName} (${messageTime(new Date().toISOString())})`,
    '', 'CRITICAL ISSUES', ...list(critical, (i) => `${i.title} (${issueAge(i.created_at)}${i.owner ? `, owner: ${i.owner.display_name}` : ''})`),
    '', 'ONGOING ITEMS', ...list(ongoing, (i) => `${i.title} (${issueAge(i.created_at)}${i.owner ? `, owner: ${i.owner.display_name}` : ''})`),
    '', 'RESOLVED TODAY', ...list(resolvedToday, (i) => i.title),
    '', 'NEXT PRIORITY', ...list(priorities, (p) => p),
  ].join('\n')
}

export default function Home() {
  const { profile, workplace } = useAuth()
  const { counts } = useUnread()
  const [summary, setSummary] = useState(null)
  const [issues, setIssues] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(new Date())
  const reloadTimer = useRef(null)
  const canManage = profile.role === 'supervisor' || profile.role === 'manager'

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const loadIssues = useCallback(async () => {
    const since = new Date(Date.now() - DAY).toISOString()
    const { data } = await supabase
      .from('issues')
      .select(ISSUE_SELECT)
      .eq('workplace_id', profile.workplace_id)
      .or(`status.eq.open,resolved_at.gte.${since}`)
      .order('created_at', { ascending: true })
    setIssues(data ?? [])
  }, [profile.workplace_id])

  useEffect(() => {
    let active = true
    Promise.all([
      supabase
        .from('summaries')
        .select('id, content, created_at')
        .eq('user_id', profile.id)
        .eq('workplace_id', profile.workplace_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      loadIssues(),
      canManage
        ? supabase.from('profiles').select('id, display_name, role').eq('workplace_id', profile.workplace_id).order('display_name')
        : Promise.resolve({ data: [] }),
    ]).then(([{ data: s }, , { data: m }]) => {
      if (!active) return
      setSummary(s)
      setMembers(m ?? [])
      setLoading(false)
    })
    return () => { active = false }
  }, [profile.id, profile.workplace_id, canManage, loadIssues])

  // Live updates when anyone (or someone else's brief) changes an issue.
  useEffect(() => {
    const sub = supabase
      .channel(`issues-${profile.workplace_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'issues', filter: `workplace_id=eq.${profile.workplace_id}` }, () => {
        clearTimeout(reloadTimer.current)
        reloadTimer.current = setTimeout(loadIssues, 250)
      })
      .subscribe()
    return () => { clearTimeout(reloadTimer.current); supabase.removeChannel(sub) }
  }, [profile.workplace_id, loadIssues])

  async function refreshSummary() {
    setError('')
    setInfo('')
    setRefreshing(true)
    const { data, error } = await supabase.functions.invoke('shift-brief', { method: 'POST' })
    setRefreshing(false)
    if (error) return setError(await readFunctionError(error))
    await loadIssues()
    if (data?.empty) return setInfo('No messages in the last 24 hours, so there is nothing new to read. Open issues are still listed below.')
    if (data?.summary) setSummary(data.summary)
    if (data?.unchanged) return setInfo('Already up to date. Nothing new has been posted since this brief was written.')
    if (data?.cooldown) return setInfo(`This brief was refreshed moments ago. You can refresh again in ${data.retry_after} seconds.`)
    const parts = []
    if (data?.created) parts.push(`${data.created} new issue${data.created === 1 ? '' : 's'}`)
    if (data?.resolved) parts.push(`${data.resolved} resolved`)
    setInfo(parts.length ? `Brief updated: ${parts.join(', ')}.` : 'Brief updated. No issues changed.')
  }

  async function onAction(kind, issue, value) {
    setError('')
    const { error } =
      kind === 'resolve' ? await supabase.rpc('resolve_issue', { p_issue: issue.id })
        : kind === 'reopen' ? await supabase.rpc('reopen_issue', { p_issue: issue.id })
          : await supabase.rpc('assign_issue', { p_issue: issue.id, p_owner: value })
    if (error) setError(error.message)
    await loadIssues()
  }

  const open = issues.filter((i) => i.status === 'open')
  const critical = open.filter((i) => i.severity === 'critical')
  const ongoing = open.filter((i) => i.severity !== 'critical')
  const resolvedToday = issues
    .filter((i) => i.status === 'resolved' && new Date(i.resolved_at).getTime() > now.getTime() - DAY)
    .sort((a, b) => b.resolved_at.localeCompare(a.resolved_at))
  const priorities = summary?.content?.next_priority ?? []
  const content = summary?.content

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(briefAsText({ critical, ongoing, resolvedToday, priorities }, workplace?.name ?? 'your workplace'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copy did not work in this browser.')
    }
  }

  const issueList = (items, color) => (
    <ul className="mt-3 space-y-2">
      {items.map((i) => <IssueItem key={i.id} issue={i} color={color} canManage={canManage} members={members} onAction={onAction} />)}
    </ul>
  )

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
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-navy-900">Your Shift Brief</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {content
                ? `Updated ${messageTime(summary.created_at)}${content.message_count ? ` from ${content.message_count} message${content.message_count === 1 ? '' : 's'}` : ''}`
                : 'Open issues stay here until they are resolved. Refresh to check the latest messages.'}
            </p>
            {content?.channels && <p className="mt-0.5 text-xs text-slate-400">Covers {content.channels.join(', ')}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" onClick={copyBrief}>
              <CopyIcon className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
            </button>
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
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Section title="Critical Issues" color="red" count={critical.length} testId="critical">
              {critical.length ? issueList(critical, 'red') : <Empty>No critical issues open.</Empty>}
            </Section>
            <Section title="Ongoing Items" color="amber" count={ongoing.length} testId="ongoing">
              {ongoing.length ? issueList(ongoing, 'amber') : <Empty>Nothing in progress.</Empty>}
            </Section>
            <Section title="Resolved Today" color="green" count={resolvedToday.length} testId="resolved">
              {resolvedToday.length ? issueList(resolvedToday, 'green') : <Empty>Nothing resolved in the last 24 hours.</Empty>}
            </Section>
            <Section title="Next Priority" color="blue" count={priorities.length} testId="priority">
              {priorities.length ? (
                <ul className="mt-3 space-y-2">
                  {priorities.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-800">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                      <span className="min-w-0">{p}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>{content ? 'No priorities set.' : 'Tap Refresh Summary to set priorities.'}</Empty>
              )}
            </Section>
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
