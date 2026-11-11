import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Notice from '../components/Notice'
import AuthShell from './AuthShell'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` })
    setBusy(false)
    if (error) {
      return setError(error.status === 429
        ? 'Too many reset emails have been requested. Wait a few minutes and try again.'
        : "We couldn't send the email just now. Check the address and try again in a few minutes.")
    }
    setSent(true)
  }

  return (
    <AuthShell
      title={sent ? 'Check your email' : 'Reset your password'}
      subtitle={sent ? undefined : "Enter the email you signed up with and we'll send you a link to choose a new password."}
      footer={<Link to="/login" className="font-semibold text-teal-brand hover:underline">Back to sign in</Link>}
    >
      {sent ? (
        <p className="text-sm text-slate-600">
          If an account exists for <span className="font-medium text-slate-800">{email}</span>, a reset link is on its way. It can take a minute to arrive, so check your spam folder too.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="reset-email" className="label">Email</label>
            <input id="reset-email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Notice kind="error">{error}</Notice>
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
    </AuthShell>
  )
}
