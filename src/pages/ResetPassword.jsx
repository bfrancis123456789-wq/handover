import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import Notice from '../components/Notice'
import AuthShell from './AuthShell'

export default function ResetPassword() {
  const { finishRecovery } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('Use a password with at least 8 characters.')
    if (password !== confirm) return setError('The two passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    finishRecovery()
    navigate('/', { replace: true })
  }

  return (
    <AuthShell title="Choose a new password" subtitle="You'll stay signed in on this device.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="reset-password" className="label">New password</label>
          <input id="reset-password" type="password" autoComplete="new-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
        </div>
        <div>
          <label htmlFor="reset-confirm" className="label">Confirm new password</label>
          <input id="reset-confirm" type="password" autoComplete="new-password" required className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Notice kind="error">{error}</Notice>
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
    </AuthShell>
  )
}
