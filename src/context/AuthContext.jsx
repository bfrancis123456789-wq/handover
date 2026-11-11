import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)
  const [workplace, setWorkplace] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      setWorkplace(null)
      setProfileLoading(false)
      return
    }
    setProfileLoading(true)
    const { data: p } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(p)
    if (p?.workplace_id) {
      const { data: w } = await supabase
        .from('workplaces')
        .select('id, name, owner_id')
        .eq('id', p.workplace_id)
        .maybeSingle()
      setWorkplace(w)
    } else {
      setWorkplace(null)
    }
    setProfileLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  useEffect(() => {
    if (session === undefined) return
    loadProfile(userId)
  }, [userId, session === undefined, loadProfile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up role changes made by a manager while this user is signed in.
  useEffect(() => {
    if (!userId) return
    const ch = supabase
      .channel(`profile-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, (payload) =>
        setProfile((prev) => ({ ...prev, ...payload.new })),
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [userId])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    workplace,
    loading: session === undefined || (Boolean(session) && profileLoading),
    refresh: () => loadProfile(userId),
    updateProfileLocal: (patch) => setProfile((prev) => ({ ...prev, ...patch })),
    signOut: () => supabase.auth.signOut(),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
