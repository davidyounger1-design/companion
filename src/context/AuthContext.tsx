import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { ensureProfile } from '../lib/auth'
import { reconcileOrgPlan } from '../lib/reconcilePlan'
import { roleHome } from '../lib/roleHome'
import { isOverParticipantSeats, CHOOSE_PARTICIPANTS_PATH } from '../lib/seatOverage'
import { ACTIVE_ORG_STORAGE_KEY } from '../lib/activeOrg'
import type { Profile, Organisation } from '../types/database'

type Membership = { org_id: string; role: string; org_name: string }

interface AuthState {
  user: User | null
  session: Session | null
  profile: Profile | null
  org: Organisation | null
  loading: boolean
  refreshProfile: () => Promise<void>
  /** Every org this profile currently belongs to. Length 1 for everyone
   *  today — the plan switcher only appears once someone has 2+. */
  memberships: Membership[]
  switchOrg: (orgId: string) => Promise<void>
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  profile: null,
  org: null,
  loading: true,
  refreshProfile: async () => {},
  memberships: [],
  switchOrg: async () => {},
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
    memberships: [],
    switchOrg: async () => {},
  })

  async function refreshProfile() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { profile, org, memberships } = await hydrateUser(user)
    setState((prev) => ({ ...prev, profile, org, memberships }))
  }

  // Person-side roles (family/recipient) always get a merged view and never
  // switch — only staff-side roles (coordinator/support_worker) span more
  // than one plan in practice, but this checks role generically rather than
  // hardcoding that, since nothing stops a person-side role from also
  // holding a staff membership elsewhere.
  async function switchOrg(orgId: string) {
    sessionStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { profile, org, memberships } = await hydrateUser(user)
    setState((prev) => ({ ...prev, profile, org, memberships }))
    if (profile) navigate(roleHome(profile.role, org?.org_type), { replace: true })
  }

  // If a plan downgrade left more active participants than the org's current
  // seat limit allows (nobody prompted at downgrade time — plan changes
  // happen entirely in MAB's portal, outside the app), send the coordinator
  // to the picker instead of wherever they'd otherwise land. Runs on every
  // hydrate (not just when reconcileOrgPlan detects a fresh change) so it's
  // self-healing even if the overage already existed from a previous session.
  async function guardSeatOverage(profile: Profile | null, org: Organisation | null): Promise<boolean> {
    if (profile?.role !== 'coordinator' || !org) return false
    if (window.location.pathname === CHOOSE_PARTICIPANTS_PATH) return false
    if (!(await isOverParticipantSeats(org))) return false
    navigate(CHOOSE_PARTICIPANTS_PATH, { replace: true })
    return true
  }

  // Load the subscribed plan from MAB and correct the local org mirror if it
  // disagrees (plan/org_type/billing_status) — runs once per session load, in
  // the background, so there's a short delay before the display (and, for a
  // coordinator whose org type just changed, the route) catches up.
  function reconcileInBackground(profile: Profile | null, org: Organisation | null) {
    if (!org) return
    reconcileOrgPlan(org).then(async (patch) => {
      if (!patch) return
      const mergedOrg = { ...org, ...patch }
      setState((prev) => ({ ...prev, org: prev.org ? { ...prev.org, ...patch } : prev.org }))
      if (await guardSeatOverage(profile, mergedOrg)) return
      if (patch.org_type && profile?.role === 'coordinator') {
        navigate(roleHome(profile.role, patch.org_type), { replace: true })
      }
    })
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        hydrateUser(session.user).then(async ({ profile, org, memberships }) => {
          setState((prev) => ({ ...prev, user: session.user, session, profile, org, memberships, loading: false }))
          if (await guardSeatOverage(profile, org)) return
          reconcileInBackground(profile, org)
        })
      } else {
        setState((prev) => ({ ...prev, user: null, session: null, profile: null, org: null, memberships: [], loading: false }))
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
        hydrateUser(session.user).then(async ({ profile, org, memberships }) => {
          setState((prev) => ({ ...prev, user: session.user, session, profile, org, memberships, loading: false }))
          if (await guardSeatOverage(profile, org)) return
          reconcileInBackground(profile, org)
        })
      } else {
        setState((prev) => ({ ...prev, user: null, session: null, profile: null, org: null, memberships: [], loading: false }))
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={{ ...state, refreshProfile, switchOrg }}>{children}</AuthContext.Provider>
}

async function hydrateUser(
  user: User,
): Promise<{ profile: Profile | null; org: Organisation | null; memberships: Membership[] }> {
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
      return { profile: null, org: null, memberships: [] }
    }
  }

  if (!profile) return { profile: null, org: null, memberships: [] }

  // Every org this profile currently belongs to (profile_orgs is what
  // my_org_id()/my_role() actually resolve against — profiles.org_id/role
  // is kept in sync as the "primary" for display, but the active context
  // below is what decides what's actually shown).
  const { data: rows } = await supabase
    .from('profile_orgs')
    .select('org_id, role, organisations(name)')
    .eq('profile_id', profile.id)
    .is('left_at', null)
  const memberships: Membership[] = (rows ?? []).map((r) => ({
    org_id: r.org_id,
    role: r.role,
    org_name: (r.organisations as unknown as { name: string } | null)?.name ?? 'Unknown plan',
  }))

  // Resolve which membership is active: a stored choice if it's still
  // valid, else the profile's primary org_id if that's still a real
  // membership, else the first membership found. Self-healing if the
  // stored choice points at an org this profile has since left.
  const stored = sessionStorage.getItem(ACTIVE_ORG_STORAGE_KEY)
  const active =
    memberships.find((m) => m.org_id === stored) ??
    memberships.find((m) => m.org_id === profile!.org_id) ??
    memberships[0] ??
    null
  if (active) sessionStorage.setItem(ACTIVE_ORG_STORAGE_KEY, active.org_id)
  else sessionStorage.removeItem(ACTIVE_ORG_STORAGE_KEY)

  // Effective profile: role reflects the ACTIVE membership, not
  // necessarily the raw profiles row (which is just the "primary" for
  // single-membership backward-compat and display). Everything else in
  // the app reads profile.role/org_id and should keep working unchanged,
  // now automatically respecting whichever plan is active.
  const effectiveProfile: Profile = active
    ? { ...profile, org_id: active.org_id, role: active.role as Profile['role'] }
    : profile

  let org: Organisation | null = null
  if (active) {
    const { data } = await supabase.from('organisations').select('*').eq('id', active.org_id).maybeSingle()
    org = data
  }

  return { profile: effectiveProfile, org, memberships }
}

export function useAuth() {
  return useContext(AuthContext)
}
