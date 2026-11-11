export function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export const longDate = (d = new Date()) =>
  d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export function messageTime(iso) {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return time
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`
}

export const firstName = (name = '') => name.trim().split(/\s+/)[0] || 'there'

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'

export function dayLabel(iso) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) })
}
