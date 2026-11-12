import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { messageTime } from '../lib/format'
import Notice from '../components/Notice'
import Spinner from '../components/Spinner'
import { LockIcon, UsersIcon } from '../components/Icons'

// Must match the field rules in the shift_reports migration and brief_report_context().
export const REPORT_FIELDS = [
  { key: 'overview', label: 'Overview', shared: false, hint: 'How the shift went: how busy, staffing, anything notable.' },
  { key: 'incidents', label: 'Incidents', shared: false, hint: 'Guest complaints, accidents or injuries, theft, cash discrepancies. Describe what happened.', note: 'Serious incidents may also need reporting to your manager and the relevant authority. This report doesn\'t replace that.' },
  { key: 'hazards', label: 'Hazards', shared: true, hint: 'Wet floors, broken or unsafe equipment, blocked exits: anything staff need to watch out for.' },
  { key: 'resolutions', label: 'Resolutions', shared: true, hint: 'Problems that were fixed or closed this shift.' },
  { key: 'handover_notes', label: 'Handover notes', shared: true, hint: 'What the next shift needs to know or do.' },
]
const SHIFTS = [['day', 'Day'], ['am', 'AM'], ['pm', 'PM'], ['night', 'Night']]
const shiftName = (s) => SHIFTS.find(([k]) => k === s)?.[1] ?? s
const DAY_MS = 24 * 60 * 60 * 1000
const REPORT_SELECT = '*, author:profiles!shift_reports_author_id_fkey(display_name)'

const dateLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const fieldsOf = (r) => Object.fromEntries(REPORT_FIELDS.map((f) => [f.key, r?.[f.key] ?? '']))

function Visibility({ shared }) {
  return shared ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-teal-soft px-2 py-0.5 text-[11px] font-semibold text-teal-dark"><UsersIcon className="h-3.5 w-3.5" /> Shared with the whole team</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"><LockIcon className="h-3.5 w-3.5" /> Supervisors and managers only</span>
  )
}

function StatusLine({ report }) {
  if (!report) return null
  if (report.status === 'draft') return <span>Draft, not submitted yet</span>
  const lockAt = new Date(report.submitted_at).getTime() + DAY_MS
  const locked = Date.now() > lockAt
  return (
    <span>
      Submitted {messageTime(report.submitted_at)}
      {report.edited_at && <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900" data-testid="edited-label">Edited {messageTime(report.edited_at)}</span>}
      {' · '}
      {locked ? 'Locked' : `You can change it until ${messageTime(new Date(lockAt).toISOString())}`}
    </span>
  )
}

// The report form: autosaves drafts; after submitting, changes are saved with "Save changes".
function ReportForm({ report, onSaved }) {
  const [values, setValues] = useState(() => fieldsOf(report))
  const [saveState, setSaveState] = useState('')
  const [notice, setNotice] = useState({ kind: 'info', text: '' })
  const [busy, setBusy] = useState(false)
  const [confirmDraft, setConfirmDraft] = useState(false)
  const [aiDrafted, setAiDrafted] = useState(report.ai_drafted)
  const timer = useRef(null)
  const isDraft = report.status === 'draft'
  const locked = !isDraft && Date.now() > new Date(report.submitted_at).getTime() + DAY_MS
  const dirty = REPORT_FIELDS.some((f) => values[f.key] !== (report[f.key] ?? ''))

  useEffect(() => { setValues(fieldsOf(report)); setAiDrafted(report.ai_drafted) }, [report.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (next, { submit = false, ai } = {}) => {
    setSaveState('saving')
    const { data, error } = await supabase.rpc('update_shift_report', { p_report: report.id, p_fields: next, p_submit: submit, p_ai_drafted: ai ?? null })
    if (error) {
      setSaveState('')
      setNotice({ kind: 'error', text: error.message || 'The report was not saved. Check your connection and try again.' })
      return false
    }
    setSaveState('saved')
    onSaved?.(data)
    return true
  }, [report.id, onSaved])

  function change(key, value) {
    const next = { ...values, [key]: value }
    setValues(next)
    if (isDraft) {
      clearTimeout(timer.current)
      timer.current = setTimeout(() => save(next), 1200)
    }
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  async function draftWithAi() {
    setConfirmDraft(false)
    setBusy(true)
    setNotice({ kind: 'info', text: '' })
    const { data, error } = await supabase.functions.invoke('report-draft', { body: {} })
    setBusy(false)
    if (error) {
      let text = 'The draft could not be written. You can still write the report yourself.'
      try { text = (await error.context.json()).error || text } catch { /* keep default */ }
      return setNotice({ kind: 'error', text })
    }
    if (data?.empty) return setNotice({ kind: 'info', text: 'There are no messages from today yet, so there\'s nothing to draft from.' })
    const next = { ...values, ...data.fields }
    setValues(next)
    setAiDrafted(true)
    if (isDraft) await save(next, { ai: true })
    setNotice({ kind: 'info', text: `Draft written from ${data.message_count} message${data.message_count === 1 ? '' : 's'} today. Check every section and make changes before you submit.` })
  }

  async function submit() {
    clearTimeout(timer.current)
    setBusy(true)
    const ok = await save(values, { submit: true, ai: aiDrafted })
    setBusy(false)
    if (ok) setNotice({ kind: 'success', text: isDraft
      ? 'Report submitted. Its hazards, resolutions and handover notes will be included in everyone\'s shift brief.'
      : 'Changes saved. The earlier version has been kept.' })
  }

  const hasContent = REPORT_FIELDS.some((f) => values[f.key].trim())

  return (
    <div className="space-y-4">
      {!locked && (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="min-w-0 text-sm text-slate-600">Start from an AI draft of today's messages, then check and edit it.</p>
          {!confirmDraft ? (
            <button className="btn-secondary" onClick={() => (hasContent ? setConfirmDraft(true) : draftWithAi())} disabled={busy}>
              {busy ? <Spinner /> : null} {busy ? 'Drafting…' : 'Draft with AI'}
            </button>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-200">
              <p className="w-full text-sm text-amber-900 sm:w-auto sm:flex-1">Replace what you've written with an AI draft?</p>
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={draftWithAi}>Replace with draft</button>
              <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setConfirmDraft(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}

      <Notice kind={notice.kind}>{notice.text}</Notice>
      {locked && <Notice kind="info">This report is locked. Reports can be changed for 24 hours after they're submitted.</Notice>}

      {REPORT_FIELDS.map((f) => (
        <section key={f.key} className="card p-4 sm:p-5" data-field={f.key}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor={`report-${f.key}`} className="font-semibold text-navy-900">{f.label}</label>
            <Visibility shared={f.shared} />
          </div>
          <p className="mt-1 text-sm text-slate-500">{f.hint}</p>
          <textarea
            id={`report-${f.key}`}
            rows={4}
            maxLength={4000}
            readOnly={locked}
            value={values[f.key]}
            onChange={(e) => change(f.key, e.target.value)}
            className="input mt-3 resize-y read-only:bg-slate-50"
          />
          {f.note && <p className="mt-2 text-xs text-slate-500" data-testid="incidents-note">{f.note}</p>}
        </section>
      ))}

      {!locked && (
        <div className="flex flex-wrap items-center gap-3 pb-4">
          {isDraft ? (
            <button className="btn-primary" onClick={submit} disabled={busy || !hasContent}>Submit report</button>
          ) : (
            <button className="btn-primary" onClick={submit} disabled={busy || !dirty}>Save changes</button>
          )}
          <span className="text-sm text-slate-500" role="status" data-testid="save-state">
            {saveState === 'saving' ? 'Saving…' : isDraft && saveState === 'saved' ? 'Draft saved' : ''}
          </span>
        </div>
      )}
    </div>
  )
}

function ReadOnlyFields({ fields }) {
  return (
    <div className="space-y-3">
      {REPORT_FIELDS.map((f) => (
        <section key={f.key} className="card p-4" data-field={f.key}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-navy-900">{f.label}</h3>
            <Visibility shared={f.shared} />
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{fields[f.key]?.trim() || <span className="text-slate-400">Nothing reported.</span>}</p>
        </section>
      ))}
    </div>
  )
}

function RecentReports({ refreshKey }) {
  const [reports, setReports] = useState(null)
  useEffect(() => {
    supabase.from('shift_reports').select('id, report_date, shift, status, submitted_at, edited_at, author:profiles!shift_reports_author_id_fkey(display_name)')
      .eq('status', 'submitted').order('submitted_at', { ascending: false }).limit(30)
      .then(({ data }) => setReports(data ?? []))
  }, [refreshKey])
  return (
    <section className="card" aria-labelledby="recent-title">
      <h2 id="recent-title" className="border-b border-slate-100 p-4 font-semibold text-navy-900 sm:px-5">Recent reports</h2>
      {!reports ? <div className="flex justify-center py-6"><Spinner className="h-5 w-5 text-teal-brand" /></div>
        : reports.length === 0 ? <p className="p-4 text-sm text-slate-500 sm:px-5">No reports submitted yet.</p>
        : (
          <ul className="divide-y divide-slate-100">
            {reports.map((r) => (
              <li key={r.id}>
                <Link to={`/reports/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-4 hover:bg-slate-50 sm:px-5" data-testid="recent-report">
                  <span className="font-medium text-navy-900">{dateLabel(r.report_date)} · {shiftName(r.shift)}</span>
                  <span className="text-sm text-slate-500">{r.author?.display_name ?? 'Former member'}</span>
                  {r.edited_at && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Edited</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

// Today's report for a shift, plus the recent reports list.
export default function ShiftReport() {
  const { profile } = useAuth()
  const [shift, setShift] = useState('day')
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const allowed = profile.role === 'supervisor' || profile.role === 'manager'

  const load = useCallback(async (s) => {
    setReport(null)
    setError('')
    const { data: id, error } = await supabase.rpc('start_shift_report', { p_shift: s })
    if (error) return setError(error.message)
    const { data } = await supabase.from('shift_reports').select(REPORT_SELECT).eq('id', id).single()
    setReport(data)
  }, [])

  useEffect(() => { if (allowed) load(shift) }, [allowed, shift, load])

  const onSaved = useCallback(async (saved) => {
    if (saved?.status === 'submitted') {
      const { data } = await supabase.from('shift_reports').select(REPORT_SELECT).eq('id', saved.id).single()
      if (data) setReport(data)
      setRefreshKey((k) => k + 1)
    }
  }, [])

  if (!allowed) return <Navigate to="/" replace />

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6 lg:py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-navy-900">Shift report</h1>
        <p className="mt-1 text-sm text-slate-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · <StatusLine report={report} /></p>
      </div>

      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Shift">
        <span className="text-sm text-slate-500">Shift:</span>
        {SHIFTS.map(([k, label]) => (
          <button key={k} role="radio" aria-checked={shift === k} onClick={() => setShift(k)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset ${shift === k ? 'bg-teal-brand text-white ring-teal-brand' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {!report ? <div className="flex justify-center py-10"><Spinner className="h-6 w-6 text-teal-brand" /></div>
        : <ReportForm report={report} onSaved={onSaved} />}

      <RecentReports refreshKey={refreshKey} />
    </div>
  )
}

// A submitted report. Its author can edit it for 24 hours; managers see earlier versions.
export function ShiftReportView() {
  const { reportId } = useParams()
  const { profile } = useAuth()
  const [report, setReport] = useState(undefined)
  const [versions, setVersions] = useState([])
  const allowed = profile.role === 'supervisor' || profile.role === 'manager'

  const load = useCallback(async () => {
    const { data } = await supabase.from('shift_reports').select(REPORT_SELECT).eq('id', reportId).maybeSingle()
    setReport(data ?? null)
    if (profile.role === 'manager') {
      const { data: v } = await supabase.from('shift_report_versions').select('*').eq('report_id', reportId).order('version', { ascending: false })
      setVersions(v ?? [])
    }
  }, [reportId, profile.role])

  useEffect(() => { if (allowed) load() }, [allowed, load])

  if (!allowed) return <Navigate to="/" replace />
  if (report === undefined) return <div className="flex justify-center py-16"><Spinner className="h-6 w-6 text-teal-brand" /></div>
  if (report === null) return <div className="mx-auto max-w-2xl px-4 py-10"><Notice kind="error">That report isn't available.</Notice></div>

  const mine = report.author_id === profile.id
  const editable = mine && report.status === 'submitted' && Date.now() < new Date(report.submitted_at).getTime() + DAY_MS

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6 lg:py-10">
      <div>
        <Link to="/reports" className="text-sm font-medium text-teal-dark hover:underline">Back to shift reports</Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-900">{dateLabel(report.report_date)} · {shiftName(report.shift)} shift</h1>
        <p className="mt-1 text-sm text-slate-500">By {report.author?.display_name ?? 'Former member'} · <StatusLine report={report} /></p>
      </div>
      {editable ? <ReportForm report={report} onSaved={load} /> : <ReadOnlyFields fields={report} />}
      {profile.role === 'manager' && versions.length > 0 && (
        <section className="card p-4 sm:p-5" aria-labelledby="versions-title" data-testid="versions">
          <h2 id="versions-title" className="font-semibold text-navy-900">Earlier versions ({versions.length})</h2>
          <p className="mt-1 text-sm text-slate-500">Each time the report was changed, the version before it was kept.</p>
          <div className="mt-3 space-y-2">
            {versions.map((v) => (
              <details key={v.id} className="rounded-lg ring-1 ring-slate-200">
                <summary className="cursor-pointer list-none p-3 text-sm font-medium text-navy-900">Version {v.version}, saved {messageTime(v.saved_at)}</summary>
                <div className="p-3 pt-0"><ReadOnlyFields fields={v} /></div>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
