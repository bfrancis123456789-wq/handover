import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { forgetDevice } from '../lib/push'
import { setMonitoringUser } from '../lib/monitoring'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)
  const [workplace, setWorkplace] = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [recovery, setRecovery] = useState(false) // signed in from a password reset link
  const [leftWorkplace, setLeftWorkplace] = useState(null) // name of the workplace the user just left or was removed from
  const workplaceRef = useRef(null)
  workplaceRef.current = workplace

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
        .select('id, name, owner_id, is_demo')
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
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setRecovery(false)
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  useEffect(() => { setMonitoringUser(userId) }, [userId])
  useEffect(() => {
    if (session === undefined) return
    loadProfile(userId)
  }, [userId, session === undefined, loadProfile]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pick up role changes made by a manager while this user is signed in.
  useEffect(() => {
    if (!userId) return
    const ch = supabase
      .channel(`profile-${userId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, (payload) => {
        if (!payload.new.workplace_id && workplaceRef.current) {
          setLeftWorkplace(workplaceRef.current.name)
          setWorkplace(null)
        }
        setProfile((prev) => ({ ...prev, ...payload.new }))
      })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [userId])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    workplace,
    loading: session === undefined || (Boolean(session) && profileLoading),
    recovery,
    finishRecovery: () => setRecovery(false),
    leftWorkplace,
    refresh: () => loadProfile(userId),
    noteLeft: (name) => setLeftWorkplace(name),
    updateProfileLocal: (patch) => setProfile((prev) => ({ ...prev, ...patch })),
    signOut: async () => {
      await forgetDevice()
      return supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
