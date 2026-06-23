import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { ensureProfile } from '../lib/auth'
import type { Profile } from '../types/database'

interface AuthState {
  user: User | null
  session: Session | null
  profile: Profile | null
  loading: boolean
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  profile: null,
  loading: true,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    loading: true,
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        hydrateUser(session.user, session).then((profile) =>
          setState({ user: session.user, session, profile, loading: false }),
        )
      } else {
        setState({ user: null, session: null, profile: null, loading: false })
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        hydrateUser(session.user, session).then((profile) =>
          setState({ user: session.user, session, profile, loading: false }),
        )
      } else {
        setState({ user: null, session: null, profile: null, loading: false })
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

async function hydrateUser(user: User, _session: Session): Promise<Profile | null> {
  // Load existing profile
  const { data: existing } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (existing) return existing

  // First sign-in after email confirmation — create the profile from metadata
  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split('@')[0] ??
    'Coordinator'

  try {
    await ensureProfile(user.id, fullName)
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
    return data
  } catch {
    return null
  }
}

export function useAuth() {
  return useContext(AuthContext)
}
