import { Suspense, useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { UnreadProvider, formatCount, useUnread } from '../context/UnreadContext'
import { channelsFor } from '../lib/constants'
import Avatar from './Avatar'
import Logo from './Logo'
import RoleBadge from './RoleBadge'
import WelcomeDialog from './WelcomeDialog'
import FeedbackDialog from './FeedbackDialog'
import Spinner from './Spinner'
import { syncPushSubscription } from '../lib/push'
import { supabase } from '../lib/supabase'
import { recordDailyOpen } from '../lib/analytics'
import {
  BellIcon, ChatIcon, HashIcon, HelpIcon, HomeIcon, KeyIcon, LockIcon, LogoutIcon, MenuIcon, UserIcon, UsersIcon, XIcon,
} from './Icons'

function useIsPlatformAdmin() {
  const [admin, setAdmin] = useState(false)
  useEffect(() => {
    supabase.rpc('my_admin_status').then(({ data }) => setAdmin(Boolean(data?.admin)), () => {})
  }, [])
  return admin
}

const SETTINGS = [
  { to: '/settings/profile', label: 'My Profile', icon: UserIcon },
  { to: '/settings/notifications', label: 'Notifications', icon: BellIcon },
  { to: '/settings/account', label: 'Account', icon: KeyIcon },
  { to: '/settings/help', label: 'Help & Support', icon: HelpIcon },
  { to: '/settings/team', label: 'Manage Team', icon: UsersIcon, managerOnly: true },
]

function UnreadBadge({ count, muted }) {
  if (!count) return null
  if (muted) return <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-slate-400" aria-label="New messages (muted)" />
  return (
    <span className="ml-auto shrink-0 rounded-full bg-teal-brand px-1.5 py-0.5 text-[11px] font-bold leading-none text-white tabular-nums" aria-label={`${count} unread`}>
      {formatCount(count)}
    </span>
  )
}

function NavItem({ to, icon: Icon, children, end, onNavigate, badge }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive ? 'bg-teal-brand text-white' : 'text-slate-300 hover:bg-navy-800 hover:text-white'
        }`
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{children}</span>
      {badge}
    </NavLink>
  )
}

function SectionLabel({ children }) {
  return <p className="mb-1.5 mt-6 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{children}</p>
}

function Sidebar({ onClose, onFeedback }) {
  const { profile, workplace, signOut } = useAuth()
  const { counts } = useUnread()
  const channels = channelsFor(profile.role)
  const muted = (id) => profile.notification_settings?.[id] === false
  const settings = SETTINGS.filter((s) => !s.managerOnly || profile.role === 'manager')
  const isAdmin = useIsPlatformAdmin()

  return (
    <div className="flex h-full flex-col bg-navy-900 text-white">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <Logo withText />
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-2 text-slate-300 hover:bg-navy-800 lg:hidden" aria-label="Close menu">
            <XIcon />
          </button>
        )}
      </div>
      <p className="truncate px-4 text-xs text-slate-400">{workplace?.name}</p>

      <nav className="mt-4 flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        <NavItem to="/" icon={HomeIcon} end onNavigate={onClose}>Home</NavItem>

        <SectionLabel>Channels</SectionLabel>
        <div className="space-y-0.5">
          {channels.map((c) => (
            <NavItem key={c.id} to={`/channels/${c.id}`} icon={c.roles.length < 3 ? LockIcon : HashIcon} onNavigate={onClose}
              badge={<UnreadBadge count={counts[c.id]} muted={muted(c.id)} />}>
              {c.name}
            </NavItem>
          ))}
        </div>

        <SectionLabel>Settings</SectionLabel>
        <div className="space-y-0.5">
          {settings.map((s) => (
            <NavItem key={s.to} to={s.to} icon={s.icon} onNavigate={onClose}>{s.label}</NavItem>
          ))}
          <button
            type="button"
            onClick={() => { onClose?.(); onFeedback() }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-300 transition hover:bg-navy-800 hover:text-white"
          >
            <ChatIcon className="h-[18px] w-[18px] shrink-0" />
            <span className="truncate">Send feedback</span>
          </button>
          {isAdmin && <NavItem to="/admin" icon={LockIcon} onNavigate={onClose}>Founder dashboard</NavItem>}
        </div>
      </nav>

      <div className="flex items-center gap-3 border-t border-navy-800 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Avatar name={profile.display_name} url={profile.avatar_url} size="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{profile.display_name}</p>
          <RoleBadge role={profile.role} className="mt-0.5" />
        </div>
        <button onClick={signOut} className="rounded-lg p-2 text-slate-300 hover:bg-navy-800 hover:text-white" aria-label="Sign out" title="Sign out">
          <LogoutIcon className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  )
}

function LayoutInner() {
  const [open, setOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const location = useLocation()
  const { profile, workplace } = useAuth()
  const { counts } = useUnread()
  const anyUnread = Object.entries(counts).some(([ch, n]) => n > 0 && profile.notification_settings?.[ch] !== false)

  useEffect(() => setOpen(false), [location.pathname])
  useEffect(() => { syncPushSubscription() }, [profile.id])
  useEffect(() => { recordDailyOpen() }, [profile.workplace_id])

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <Sidebar onFeedback={() => setFeedbackOpen(true)} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <Sidebar onClose={() => setOpen(false)} onFeedback={() => setFeedbackOpen(true)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {workplace?.is_demo && (
          <p className="bg-teal-brand px-4 py-1.5 text-center text-xs font-semibold text-white" role="note" data-testid="demo-banner">
            Demo workspace with sample data. Changes are undone when it's reset.
          </p>
        )}
        <header className="flex items-center gap-3 bg-navy-900 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white lg:hidden">
          <button onClick={() => setOpen(true)} className="relative -ml-2 rounded-lg p-2 hover:bg-navy-800" aria-label="Open menu">
            <MenuIcon />
            {anyUnread && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-teal-brand ring-2 ring-navy-900" />}
          </button>
          <Logo withText className="h-7 w-7" />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-teal-brand" /></div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {!profile.has_onboarded && <WelcomeDialog />}
      {feedbackOpen && <FeedbackDialog onClose={() => setFeedbackOpen(false)} />}
    </div>
  )
}

export default function Layout() {
  return (
    <UnreadProvider>
      <LayoutInner />
    </UnreadProvider>
  )
}
