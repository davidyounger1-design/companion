import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export type PermissionKey =
  | 'view_all_entries'
  | 'edit_any_entry'
  | 'edit_own_entry'
  | 'add_entries'
  | 'post_notices'
  | 'send_messages'
  | 'invite_members'

type RolePerms = Record<PermissionKey, boolean>
type PermissionsMap = Partial<Record<string, Partial<RolePerms>>>

// Hardcoded defaults — coordinator always has everything
const COORDINATOR_PERMS: RolePerms = {
  view_all_entries: true,
  edit_any_entry: true,
  edit_own_entry: true,
  add_entries: true,
  post_notices: true,
  send_messages: true,
  invite_members: true,
}

const DEFAULT_PERMS: Record<string, RolePerms> = {
  family: {
    view_all_entries: true,
    edit_any_entry: true,
    edit_own_entry: true,
    add_entries: true,
    post_notices: true,
    send_messages: true,
    invite_members: true,
  },
  trusted_support_worker: {
    view_all_entries: false,
    edit_any_entry: false,
    edit_own_entry: true,
    add_entries: true,
    post_notices: true,
    send_messages: true,
    invite_members: true,
  },
  support_worker: {
    view_all_entries: false,
    edit_any_entry: false,
    edit_own_entry: true,
    add_entries: true,
    post_notices: false,
    send_messages: true,
    invite_members: false,
  },
  therapist: {
    view_all_entries: true,
    edit_any_entry: false,
    edit_own_entry: false,
    add_entries: false,
    post_notices: false,
    send_messages: true,
    invite_members: false,
  },
}

export function usePermissions() {
  const { profile } = useAuth()
  const role = profile?.role ?? 'support_worker'

  const { data: stored } = useQuery({
    queryKey: ['org-permissions', profile?.org_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('org_settings')
        .select('permissions')
        .eq('org_id', profile!.org_id!)
        .maybeSingle()
      return (data?.permissions ?? {}) as PermissionsMap
    },
    enabled: !!profile?.org_id,
    staleTime: 60_000,
  })

  if (role === 'coordinator') return COORDINATOR_PERMS

  const defaults = DEFAULT_PERMS[role] ?? DEFAULT_PERMS.support_worker
  const overrides = stored?.[role] ?? {}
  return { ...defaults, ...overrides } as RolePerms
}

export { DEFAULT_PERMS, COORDINATOR_PERMS }
export type { PermissionsMap, RolePerms }
