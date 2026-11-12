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

  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState({ kind: 'success', text: '' })

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteMessages, setDeleteMessages] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

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

  async function exportData() {
    setExporting(true)
    setExportMsg({ kind: 'success', text: '' })
    const { data, error } = await supabase.rpc('export_my_data')
    if (error || !data) {
      setExporting(false)
      return setExportMsg({ kind: 'error', text: 'Your data could not be exported. Try again in a moment.' })
    }
    // Add download links for your photos (valid for 7 days).
    const paths = data.messages.map((m) => m.photo).filter(Boolean)
    if (paths.length) {
      const { data: links } = await supabase.storage.from('message-images').createSignedUrls(paths, 60 * 60 * 24 * 7)
      const byPath = Object.fromEntries((links ?? []).filter((l) => l.signedUrl).map((l) => [l.path, l.signedUrl]))
      data.messages = data.messages.map((m) => (m.photo ? { ...m, photo_download_link: byPath[m.photo] ?? null } : m))
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `handover-my-data-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setExporting(false)
    setExportMsg({ kind: 'success', text: `Downloaded your data: ${data.messages.length} message${data.messages.length === 1 ? '' : 's'}, your profile and settings.` })
  }

  async function deleteAccount() {
    setDeleting(true)
    setDeleteError('')
    const { error } = await supabase.functions.invoke('delete-account', { body: { delete_messages: deleteMessages } })
    if (error) {
      let message = 'Your account could not be deleted. Try again in a moment.'
      try { message = (await error.context.json()).error || message } catch { /* keep default */ }
      setDeleting(false)
      return setDeleteError(message)
    }
    try { sessionStorage.setItem('handover:account-deleted', '1') } catch { /* not critical */ }
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {})
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

      <Section title="Export my data" subtitle="Download a copy of your profile, settings and the messages you've posted, as a file you can keep.">
        <div className="space-y-3">
          <Notice kind={exportMsg.kind}>{exportMsg.text}</Notice>
          <button className="btn-secondary" onClick={exportData} disabled={exporting}>{exporting ? 'Preparing your file…' : 'Download my data'}</button>
        </div>
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

      <Section danger title="Delete my account" subtitle="Permanently delete your account, profile, photo, settings and notification devices. This can't be undone.">
        {!confirmDelete ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Want a copy first? Use Export my data above.</p>
            <button className="btn-danger" onClick={() => setConfirmDelete(true)}>Delete my account</button>
          </div>
        ) : (
          <div className="space-y-3 rounded-xl bg-red-50 p-4 ring-1 ring-inset ring-red-200">
            <p className="text-sm font-medium text-red-800">Delete your account for good? You'll be signed out straight away.</p>
            <label htmlFor="delete-messages" className="flex items-start gap-3 text-sm text-red-900">
              <input id="delete-messages" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-red-600" checked={deleteMessages} onChange={(e) => setDeleteMessages(e.target.checked)} />
              <span>Also delete the messages and photos I've posted. If you leave this unticked, they stay for your team and show as from a former member.</span>
            </label>
            {deleteError && <Notice kind="error">{deleteError}</Notice>}
            <div className="flex flex-wrap gap-2">
              <button className="btn-danger" onClick={deleteAccount} disabled={deleting}>{deleting ? 'Deleting…' : 'Yes, delete my account'}</button>
              <button className="btn-secondary" onClick={() => { setConfirmDelete(false); setDeleteError('') }} disabled={deleting}>Cancel</button>
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">
          Read how we handle your information in our <a href="/privacy" className="font-medium text-teal-dark underline">Privacy Policy</a>.
        </p>
      </Section>
    </div>
  )
}
