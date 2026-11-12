import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { TERMS_VERSION } from '../lib/legal'
import Notice from '../components/Notice'
import AuthShell from './AuthShell'

export default function Signup() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')
  const [checkEmail, setCheckEmail] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (fullName.trim().length < 2) return setError('Enter your full name.')
    if (password.length < 8) return setError('Use a password with at least 8 characters.')
    if (!agreed) return setError('Tick the box to agree to the Terms of Use and Privacy Policy.')
    setBusy(true)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim(), terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION },
        emailRedirectTo: window.location.origin,
      },
    })
    setBusy(false)
    if (error) return setError(error.message)
    // If email confirmation is on, there is no session yet.
    if (!data.session) setCheckEmail(true)
  }

  if (checkEmail) {
    return (
      <AuthShell title="Check your email" footer={<Link to="/login" className="font-semibold text-teal-brand hover:underline">Back to sign in</Link>}>
        <p className="text-sm text-slate-600">
          We sent a confirmation link to <span className="font-medium text-slate-800">{email}</span>. Open it to finish creating your account.
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Then create a workplace or join your team with a code."
      footer={<>Already have an account? <Link to="/login" className="font-semibold text-teal-brand hover:underline">Sign in</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="signup-name" className="label">Full name</label>
          <input id="signup-name" autoComplete="name" required className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="signup-email" className="label">Email</label>
          <input id="signup-email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="signup-password" className="label">Password</label>
          <input id="signup-password" type="password" autoComplete="new-password" required minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
        </div>
        <label htmlFor="signup-terms" className="flex items-start gap-3 text-sm text-slate-600">
          <input id="signup-terms" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-teal-brand" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          <span>
            I agree to the{' '}
            <a href="/terms" target="_blank" rel="noopener" className="font-semibold text-teal-dark underline">Terms of Use</a> and{' '}
            <a href="/privacy" target="_blank" rel="noopener" className="font-semibold text-teal-dark underline">Privacy Policy</a>.
          </span>
        </label>
        <Notice kind="error">{error}</Notice>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthShell>
  )
}
