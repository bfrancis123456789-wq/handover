import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabase'
import { canAccess } from '../lib/constants'

const UnreadContext = createContext({ counts: {}, markRead: () => {} })

export function UnreadProvider({ children }) {
  const { profile } = useAuth()
  const location = useLocation()
  const [counts, setCounts] = useState({})
  const activeChannel = useRef(null)

  const match = location.pathname.match(/^\/channels\/([a-z_]+)/)
  activeChannel.current = match ? match[1] : null

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('unread_counts')
    if (!data) return
    const next = Object.fromEntries(data.map((r) => [r.channel, Number(r.unread)]))
    if (activeChannel.current) next[activeChannel.current] = 0
    setCounts(next)
  }, [])

  // Reload when the role (and so the channel list) changes.
  useEffect(() => { load() }, [load, profile.role, profile.workplace_id])

  // Catch up after the phone was locked or the tab was in the background.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  useEffect(() => {
    const sub = supabase
      .channel(`unread-${profile.workplace_id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `workplace_id=eq.${profile.workplace_id}` }, ({ new: m }) => {
        if (m.author_id === profile.id || m.channel === activeChannel.current || !canAccess(m.channel, profile.role)) return
        setCounts((c) => ({ ...c, [m.channel]: (c[m.channel] || 0) + 1 }))
      })
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [profile.workplace_id, profile.id, profile.role])

  const markRead = useCallback(async (channel) => {
    setCounts((c) => (c[channel] ? { ...c, [channel]: 0 } : c))
    await supabase.rpc('mark_channel_read', { p_channel: channel })
  }, [])

  // Show the total in the browser tab, counting only channels with notifications on.
  const settings = profile.notification_settings ?? {}
  const total = Object.entries(counts).reduce((sum, [ch, n]) => sum + (settings[ch] === false ? 0 : n), 0)
  useEffect(() => {
    document.title = total ? `(${total > 99 ? '99+' : total}) Handover` : 'Handover'
  }, [total])

  return <UnreadContext.Provider value={{ counts, markRead }}>{children}</UnreadContext.Provider>
}

export const useUnread = () => useContext(UnreadContext)

export const formatCount = (n) => (n > 99 ? '99+' : String(n))
