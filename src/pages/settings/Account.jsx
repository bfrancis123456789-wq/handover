import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import PageHeader from '../../components/PageHeader'
import Notice from '../../components/Notice'

function Section({ title, subtitle, children, danger }) {
  return (
    <section className={`card p-5 sm:p-6 ${danger ? 'ring-red-200' : ''}`}>
      <h2 className={`font-semibold ${danger ? 'text-red-700' : 'text-navy-900'}`}>{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function Account() {
  const { user, workplace, refresh, noteLeft } = useAuth()

  const [email, setEmail] = useState('')
  const [emailMsg, setEmailMsg] = useState({ kind: 'success', text: '' })
  const [emailBusy, setEmailBusy] = useState(false)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwMsg, setPwMsg] = useState({ kind: 'success', text: '' })
  const [pwBusy, setPwBusy] = useState(false)

  const [confirmLeave, setConfirmLeave] = useState(false)
  const [leaveError, setLeaveError] = useState('')
  const [leaving, setLeaving] = useState(false)

  async function changeEmail(e) {
    e.preventDefault()
    setEmailBusy(true)
    const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: window.location.origin })
    setEmailBusy(false)
    if (error) return setEmailMsg({ kind: 'error', text: error.message })
    setEmail('')
    setEmailMsg({ kind: 'success', text: 'Check both your old and new inboxes for a link to confirm the change.' })
  }

  async function changePassword(e) {
    e.preventDefault()
    if (password.length < 8) return setPwMsg({ kind: 'error', text: 'Use a password with at least 8 characters.' })
    if (password !== confirm) return setPwMsg({ kind: 'error', text: 'The two passwords do not match.' })
    setPwBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setPwBusy(false)
    if (error) return setPwMsg({ kind: 'error', text: error.message })
    setPassword('')
    setConfirm('')
    setPwMsg({ kind: 'success', text: 'Password updated.' })
  }

  async function leave() {
    setLeaving(true)
    setLeaveError('')
    const { error } = await supabase.rpc('leave_workplace')
    if (error) {
      setLeaving(false)
      return setLeaveError(error.message)
    }
    noteLeft(workplace?.name)
    await refresh() // no workplace -> the app routes to the setup screen
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6 sm:px-6 lg:py-10">
      <PageHeader title="Account" subtitle={`Signed in as ${user.email}`} />

      <Section title="Change email" subtitle="We'll send a confirmation link before the change takes effect.">
        <form onSubmit={changeEmail} className="space-y-3">
          <label htmlFor="new-email" className="label">New email</label>
          <input id="new-email" type="email" required autoComplete="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Notice kind={emailMsg.kind}>{emailMsg.text}</Notice>
          <button className="btn-primary" disabled={emailBusy || !email.trim()}>{emailBusy ? 'Sending…' : 'Update email'}</button>
        </form>
      </Section>

      <Section title="Change password">
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label htmlFor="new-password" className="label">New password</label>
            <input id="new-password" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div>
            <label htmlFor="confirm-password" className="label">Confirm new password</label>
            <input id="confirm-password" type="password" autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <Notice kind={pwMsg.kind}>{pwMsg.text}</Notice>
          <button className="btn-primary" disabled={pwBusy || !password}>{pwBusy ? 'Saving…' : 'Update password'}</button>
        </form>
      </Section>

      <Section danger title="Leave workplace" subtitle={`You'll lose access to ${workplace?.name ?? 'this workplace'} and its channels. You can join again with a join code.`}>
        {!confirmLeave ? (
          <button className="btn-danger" onClick={() => setConfirmLeave(true)}>Leave Workplace</button>
        ) : (
          <div className="rounded-xl bg-red-50 p-4 ring-1 ring-inset ring-red-200">
            <p className="text-sm font-medium text-red-800">Leave {workplace?.name}? This takes effect straight away.</p>
            {leaveError && <div className="mt-3"><Notice kind="error">{leaveError}</Notice></div>}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-danger" onClick={leave} disabled={leaving}>{leaving ? 'Leaving…' : 'Yes, leave workplace'}</button>
              <button className="btn-secondary" onClick={() => { setConfirmLeave(false); setLeaveError('') }} disabled={leaving}>Cancel</button>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
