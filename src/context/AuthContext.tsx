import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { ensureProfile } from '../lib/auth'
import type { Profile, Organisation } from '../types/database'

interface AuthState {
  user: User | null
  session: Session | null
  profile: Profile | null
  org: Organisation | null
  loading: boolean
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  profile: null,
  org: null,
  loading: true,
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    org: null,
    loading: true,
    refreshProfile: async () => {},
  })

  async function refreshProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    let org: Organisation | null = null
    if (profile?.org_id) {
      const { data } = await supabase.from('organisations').select('*').eq('id', profile.org_id).maybeSingle()
      org = data
    }
    setState((prev) => ({ ...prev, profile, org }))
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        hydrateUser(session.user, session).then(({ profile, org }) =>
          setState((prev) => ({ ...prev, user: session.user, session, profile, org, loading: false })),
        )
      } else {
        setState((prev) => ({ ...prev, user: null, session: null, profile: null, org: null, loading: false }))
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // User clicked a password-reset link — send them to the reset form
        setState((prev) => ({ ...prev, user: session?.user ?? null, session: session ?? null, loading: false }))
        navigate('/reset-password')
        return
      }
      if (session?.user) {
        hydrateUser(session.user, session).then(({ profile, org }) =>
          setState((prev) => ({ ...prev, user: session.user, session, profile, org, loading: false })),
        )
      } else {
        setState((prev) => ({ ...prev, user: null, session: null, profile: null, org: null, loading: false }))
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ ...state, refreshProfile }}>{children}</AuthContext.Provider>
}

async function hydrateUser(user: User, _session: Session): Promise<{ profile: Profile | null; org: Organisation | null }> {
  let profile: Profile | null = null

  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (existing) {
    profile = existing
  } else {
    // First sign-in after email confirmation — create the profile from metadata
    const fullName =
      (user.user_metadata?.full_name as string | undefined) ??
      user.email?.split('@')[0] ??
      'Coordinator'
    try {
      await ensureProfile(user.id, fullName)
      const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
      profile = data
    } catch {
      return { profile: null, org: null }
    }
  }

  let org: Organisation | null = null
  if (profile?.org_id) {
    const { data } = await supabase.from('organisations').select('*').eq('id', profile.org_id).maybeSingle()
    org = data
  }

  return { profile, org }
}

export function useAuth() {
  return useContext(AuthContext)
}
