import { ROLES } from '../lib/constants'

export default function RoleBadge({ role, className = '' }) {
  const r = ROLES[role] ?? ROLES.team_member
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${r.badge} ${className}`}>
      {r.label}
    </span>
  )
}
