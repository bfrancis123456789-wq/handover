import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { ROLES, ROLE_ORDER } from '../../lib/constants'
import Avatar from '../../components/Avatar'
import PageHeader from '../../components/PageHeader'
import Notice from '../../components/Notice'
import Spinner from '../../components/Spinner'
import { CopyIcon } from '../../components/Icons'

export default function ManageTeam() {
  const { profile, refresh } = useAuth()
  const [code, setCode] = useState('')
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [msg, setMsg] = useState({ kind: 'success', text: '' })

  useEffect(() => {
    Promise.all([
      supabase.rpc('get_join_code'),
      supabase.from('profiles').select('id, display_name, avatar_url, role').eq('workplace_id', profile.workplace_id).order('display_name'),
    ]).then(([c, m]) => {
      setCode(c.data ?? '')
      setMembers(m.data ?? [])
      setLoading(false)
    })
  }, [profile.workplace_id])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setMsg({ kind: 'info', text: `Copy did not work here. Your join code is ${code}.` })
    }
  }

  async function changeRole(member, role) {
    setSavingId(member.id)
    setMsg({ kind: 'success', text: '' })
    const { error } = await supabase.rpc('set_member_role', { p_user: member.id, p_role: role })
    setSavingId(null)
    if (error) return setMsg({ kind: 'error', text: error.message })
    setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role } : m)))
    setMsg({ kind: 'success', text: `${member.display_name} is now a ${ROLES[role].label}.` })
    if (member.id === profile.id) refresh()
  }

  const counts = ROLE_ORDER.map((r) => ({ role: r, n: members.filter((m) => m.role === r).length }))

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
      <PageHeader title="Manage Team" subtitle="Invite people and set what they can see." />

      <div className="card p-5 sm:p-6">
        <h2 className="font-semibold text-navy-900">Join code</h2>
        <p className="mt-1 text-sm text-slate-500">Share this code with new staff. They join as Team Members.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="select-all rounded-xl bg-navy-900 px-5 py-3 font-mono text-2xl font-bold tracking-[0.35em] text-white">
            {loading ? '······' : code}
          </span>
          <button className="btn-primary" onClick={copy} disabled={!code}>
            <CopyIcon className="h-4 w-4" /> {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
      </div>

      <div className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4 sm:px-6">
          <h2 className="font-semibold text-navy-900">Team members <span className="font-normal text-slate-400 tabular-nums">({members.length})</span></h2>
          <p className="text-xs text-slate-500 tabular-nums">
            {counts.map((c) => `${c.n} ${ROLES[c.role].label}${c.n === 1 ? '' : 's'}`).join(' · ')}
          </p>
        </div>
        {msg.text && <div className="px-4 pt-4 sm:px-6"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
        {loading ? (
          <div className="flex justify-center py-10"><Spinner className="h-6 w-6 text-teal-brand" /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 p-4 sm:px-6">
                <Avatar name={m.display_name} url={m.avatar_url} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-navy-900">{m.display_name}{m.id === profile.id && <span className="ml-1.5 text-xs font-normal text-slate-400">(you)</span>}</p>
                </div>
                <div className="flex items-center gap-2">
                  {savingId === m.id && <Spinner className="h-4 w-4 text-teal-brand" />}
                  <label htmlFor={`role-${m.id}`} className="sr-only">Role for {m.display_name}</label>
                  <select
                    id={`role-${m.id}`}
                    value={m.role}
                    disabled={savingId === m.id}
                    onChange={(e) => changeRole(m, e.target.value)}
                    className="input w-auto py-2 pr-8"
                  >
                    {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
