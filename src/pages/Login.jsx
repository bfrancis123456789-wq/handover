import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Notice from '../components/Notice'
import AuthShell from './AuthShell'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(error.message === 'Invalid login credentials' ? 'That email and password do not match. Try again.' : error.message)
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back. Pick up where the last shift left off."
      footer={<>New to Handover? <Link to="/signup" className="font-semibold text-teal-brand hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="login-email" className="label">Email</label>
          <input id="login-email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="login-password" className="text-sm font-medium text-slate-700">Password</label>
            <Link to="/forgot-password" className="text-sm font-medium text-teal-dark hover:underline">Forgot password?</Link>
          </div>
          <input id="login-password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Notice kind="error">{error}</Notice>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </AuthShell>
  )
}
