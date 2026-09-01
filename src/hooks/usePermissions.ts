import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export type PermissionKey =
  | 'view_all_entries'
  | 'edit_any_entry'
  | 'edit_own_entry'
  | 'add_entries'
  | 'delete_own_entry'
  | 'send_messages'
  | 'invite_members'
  | 'add_goals'
  | 'edit_own_goal'
  | 'edit_any_goal'
  | 'delete_own_goal'
  | 'moderate_entries'

type RolePerms = Record<PermissionKey, boolean>
type PermissionsMap = Partial<Record<string, Partial<RolePerms>>>

// Hardcoded defaults — coordinator always has everything. Also the value
// returned while the sub-role RPC is loading for a non-coordinator: every
// key defaults to false, matching this codebase's existing fail-closed
// convention (RequireFeature in App.tsx treats "still loading" as "not
// included" the same way) rather than flashing a permissive UI that then
// narrows once the real answer arrives.
const COORDINATOR_PERMS: RolePerms = {
  view_all_entries: true,
  edit_any_entry: true,
  edit_own_entry: true,
  add_entries: true,
  delete_own_entry: true,
  send_messages: true,
  invite_members: true,
  add_goals: true,
  edit_own_goal: true,
  edit_any_goal: true,
  delete_own_goal: true,
  moderate_entries: true,
}

const ALL_DENIED: RolePerms = {
  view_all_entries: false, edit_any_entry: false, edit_own_entry: false,
  add_entries: false, delete_own_entry: false, send_messages: false,
  invite_members: false, add_goals: false, edit_own_goal: false,
  edit_any_goal: false, delete_own_goal: false, moderate_entries: false,
}

// Legacy fallback ONLY — used while org_settings.permissions still exists
// and companion.my_permissions() might not be deployed yet (PGRST202).
// Matches the pre-sub-role behaviour exactly; delete this whole block once
// the cleanup migration drops org_settings.permissions.
const LEGACY_DEFAULT_PERMS: Record<string, RolePerms> = {
  family:                 { ...COORDINATOR_PERMS },
  trusted_support_worker: { ...ALL_DENIED, edit_own_entry: true, add_entries: true, delete_own_entry: true, send_messages: true, invite_members: true, add_goals: true, edit_own_goal: true },
  support_worker:         { ...ALL_DENIED, edit_own_entry: true, add_entries: true, delete_own_entry: true, send_messages: true, add_goals: true, edit_own_goal: true },
  therapist:              { ...ALL_DENIED, view_all_entries: true, send_messages: true, add_goals: true, edit_own_goal: true },
  recipient:              { ...ALL_DENIED, view_all_entries: true, edit_own_entry: true, add_entries: true, delete_own_entry: true, add_goals: true, edit_own_goal: true },
}

export function usePermissions(): RolePerms {
  const { profile } = useAuth()
  const role = profile?.role ?? 'support_worker'
  const isCoordinator = role === 'coordinator'

  // Both queries are called on every render, unconditionally — only their
  // `enabled` flags vary. Branching on hook CALLS instead (e.g. skipping
  // the legacy query entirely for a coordinator) would violate the rules
  // of hooks the moment a profile's role changes between renders, which
  // happens routinely here (promote/demote, impersonation, accepting an
  // invite while signed in).
  const rpcQuery = useQuery({
    queryKey: ['my-permissions', profile?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_permissions')
      if (error) throw error
      return data as RolePerms
    },
    enabled: !!profile?.org_id && !isCoordinator,
    staleTime: 60_000,
  })

  // PGRST202 = companion.my_permissions() doesn't exist yet on this DB
  // (the sub-role migration hasn't been deployed, or a stale client is
  // talking to an older schema) — fall back to the legacy
  // org_settings.permissions column rather than going dark. Any other
  // error, or still loading, fails closed instead: a member sees a
  // narrower app for a moment, never a wider one.
  const isMissingFunction = (rpcQuery.error as { code?: string } | null)?.code === 'PGRST202'

  const legacyQuery = useQuery({
    queryKey: ['org-permissions', profile?.org_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('org_settings')
        .select('permissions')
        .eq('org_id', profile!.org_id!)
        .maybeSingle()
      return (data?.permissions ?? {}) as PermissionsMap
    },
    enabled: isMissingFunction && !!profile?.org_id && !isCoordinator,
    staleTime: 60_000,
  })

  if (isCoordinator) return COORDINATOR_PERMS

  if (isMissingFunction) {
    const defaults = LEGACY_DEFAULT_PERMS[role] ?? ALL_DENIED
    const overrides = legacyQuery.data?.[role] ?? {}
    return { ...defaults, ...overrides } as RolePerms
  }

  return rpcQuery.data ?? ALL_DENIED
}

export { COORDINATOR_PERMS }
export type { PermissionsMap, RolePerms }
