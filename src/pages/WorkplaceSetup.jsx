import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { firstName } from '../lib/format'
import Notice from '../components/Notice'
import AuthShell from './AuthShell'

export default function WorkplaceSetup() {
  const { profile, refresh, signOut, leftWorkplace } = useAuth()
  const [mode, setMode] = useState('join')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } =
      mode === 'create'
        ? await supabase.rpc('create_workplace', { p_name: name })
        : await supabase.rpc('join_workplace', { p_code: code })
    setBusy(false)
    if (error) return setError(error.message)
    await refresh()
  }

  const tab = (id, label) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === id}
      onClick={() => { setMode(id); setError('') }}
      className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold transition ${mode === id ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
    >
      {label}
    </button>
  )

  return (
    <AuthShell
      title={`Hi ${firstName(profile?.display_name)}, let's get you set up`}
      subtitle="Join your team with the code from your manager, or create a new workplace."
      footer={<button onClick={signOut} className="font-semibold text-slate-300 hover:text-white">Sign out</button>}
    >
      {leftWorkplace && <div className="mb-4"><Notice kind="info">You're no longer a member of {leftWorkplace}. Join or create a workplace to carry on.</Notice></div>}
      <div role="tablist" className="mb-5 flex gap-1 rounded-lg bg-slate-100 p-1">
        {tab('join', 'Join a workplace')}
        {tab('create', 'Create a workplace')}
      </div>
      <form onSubmit={submit} className="space-y-4">
        {mode === 'join' ? (
          <div>
            <label htmlFor="join-code" className="label">Join code</label>
            <input
              id="join-code"
              required
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              maxLength={6}
              placeholder="e.g. K7Q2MX"
              className="input text-center font-mono text-lg uppercase tracking-[0.35em]"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
            <p className="mt-1 text-xs text-slate-500">6 letters and numbers. You'll join as a Team Member.</p>
          </div>
        ) : (
          <div>
            <label htmlFor="workplace-name" className="label">Workplace name</label>
            <input id="workplace-name" required maxLength={80} placeholder="e.g. The Harbour Hotel" className="input" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="mt-1 text-xs text-slate-500">You'll be the manager and get a join code to share.</p>
          </div>
        )}
        <Notice kind="error">{error}</Notice>
        <button className="btn-primary w-full" disabled={busy || (mode === 'join' && code.length !== 6)}>
          {busy ? 'Please wait…' : mode === 'join' ? 'Join workplace' : 'Create workplace'}
        </button>
      </form>
    </AuthShell>
  )
}
