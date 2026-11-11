import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { isConfigured } from './lib/supabase'
import Layout from './components/Layout'
import Spinner from './components/Spinner'
import Login from './pages/Login'
import Signup from './pages/Signup'
import WorkplaceSetup from './pages/WorkplaceSetup'
import Home from './pages/Home'
import Chat from './pages/Chat'
import Profile from './pages/settings/Profile'
import Notifications from './pages/settings/Notifications'
import Account from './pages/settings/Account'
import Help from './pages/settings/Help'
import ManageTeam from './pages/settings/ManageTeam'

function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner className="h-8 w-8 text-teal-brand" />
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="card max-w-md p-6">
        <h1 className="text-lg font-semibold">Connect Supabase</h1>
        <p className="mt-2 text-sm text-slate-600">
          Copy <code className="rounded bg-slate-100 px-1">.env.example</code> to{' '}
          <code className="rounded bg-slate-100 px-1">.env.local</code>, add your Supabase URL and anon key, then restart the dev server.
        </p>
      </div>
    </div>
  )
}

export default function App() {
  const { session, profile, loading } = useAuth()

  if (!isConfigured) return <NotConfigured />
  if (loading) return <FullScreenSpinner />

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  if (!profile?.workplace_id) {
    return (
      <Routes>
        <Route path="/setup" element={<WorkplaceSetup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  const isManager = profile.role === 'manager'

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="channels/:channelId" element={<Chat />} />
        <Route path="settings/profile" element={<Profile />} />
        <Route path="settings/notifications" element={<Notifications />} />
        <Route path="settings/account" element={<Account />} />
        <Route path="settings/help" element={<Help />} />
        <Route path="settings/team" element={isManager ? <ManageTeam /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
