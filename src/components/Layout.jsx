import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { channelsFor } from '../lib/constants'
import Avatar from './Avatar'
import Logo from './Logo'
import RoleBadge from './RoleBadge'
import WelcomeDialog from './WelcomeDialog'
import {
  BellIcon, HashIcon, HelpIcon, HomeIcon, KeyIcon, LockIcon, LogoutIcon, MenuIcon, UserIcon, UsersIcon, XIcon,
} from './Icons'

const SETTINGS = [
  { to: '/settings/profile', label: 'My Profile', icon: UserIcon },
  { to: '/settings/notifications', label: 'Notifications', icon: BellIcon },
  { to: '/settings/account', label: 'Account', icon: KeyIcon },
  { to: '/settings/help', label: 'Help & Support', icon: HelpIcon },
  { to: '/settings/team', label: 'Manage Team', icon: UsersIcon, managerOnly: true },
]

function NavItem({ to, icon: Icon, children, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
          isActive ? 'bg-teal-brand text-white' : 'text-slate-300 hover:bg-navy-800 hover:text-white'
        }`
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="truncate">{children}</span>
    </NavLink>
  )
}

function SectionLabel({ children }) {
  return <p className="mb-1.5 mt-6 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{children}</p>
}

function Sidebar({ onClose }) {
  const { profile, workplace, signOut } = useAuth()
  const channels = channelsFor(profile.role)
  const settings = SETTINGS.filter((s) => !s.managerOnly || profile.role === 'manager')

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
        <NavItem to="/" icon={HomeIcon} end>Home</NavItem>

        <SectionLabel>Channels</SectionLabel>
        <div className="space-y-0.5">
          {channels.map((c) => (
            <NavItem key={c.id} to={`/channels/${c.id}`} icon={c.roles.length < 3 ? LockIcon : HashIcon}>
              {c.name}
            </NavItem>
          ))}
        </div>

        <SectionLabel>Settings</SectionLabel>
        <div className="space-y-0.5">
          {settings.map((s) => (
            <NavItem key={s.to} to={s.to} icon={s.icon}>{s.label}</NavItem>
          ))}
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

export default function Layout() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { profile } = useAuth()

  useEffect(() => setOpen(false), [location.pathname])

  return (
    <div className="flex h-full">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-navy-950/60" onClick={() => setOpen(false)} aria-label="Close menu" />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-xl">
            <Sidebar onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 bg-navy-900 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white lg:hidden">
          <button onClick={() => setOpen(true)} className="-ml-2 rounded-lg p-2 hover:bg-navy-800" aria-label="Open menu">
            <MenuIcon />
          </button>
          <Logo withText className="h-7 w-7" />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {!profile.has_onboarded && <WelcomeDialog />}
    </div>
  )
}
