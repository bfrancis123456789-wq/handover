export const SUPPORT_EMAIL = 'support@handover.app' // TODO: replace with your real support address

export const ROLES = {
  team_member: { label: 'Team Member', badge: 'bg-slate-100 text-slate-600 ring-slate-200' },
  supervisor: { label: 'Supervisor', badge: 'bg-teal-soft text-teal-dark ring-teal-brand/30' },
  manager: { label: 'Manager', badge: 'bg-gold-soft text-gold ring-gold/30' },
}

export const ROLE_ORDER = ['team_member', 'supervisor', 'manager']

// Must match can_access_channel() in the database.
export const CHANNELS = [
  { id: 'general', name: 'General', roles: ['team_member', 'supervisor', 'manager'], blurb: 'Day-to-day chat for the whole team.' },
  { id: 'announcements', name: 'Announcements', roles: ['team_member', 'supervisor', 'manager'], blurb: 'Rota changes, policies and news everyone should see.' },
  { id: 'team_member', name: 'Team Member', roles: ['team_member', 'supervisor', 'manager'], blurb: 'Swaps, cover requests and floor updates.' },
  { id: 'supervisors', name: 'Supervisors', roles: ['supervisor', 'manager'], blurb: 'Shift leads and managers only.' },
  { id: 'management', name: 'Management', roles: ['manager'], blurb: 'Managers only.' },
]

export const channelById = (id) => CHANNELS.find((c) => c.id === id)

export const canAccess = (channelId, role) => Boolean(channelById(channelId)?.roles.includes(role))

export const channelsFor = (role) => CHANNELS.filter((c) => c.roles.includes(role))
