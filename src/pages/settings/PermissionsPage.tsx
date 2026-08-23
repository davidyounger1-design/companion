import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

type BaseRole = { role: string; label: string; sub_roles_allowed: boolean }
type PermKey = {
  key: string; label: string; description: string | null
  kind: 'gate' | 'grant'; enforced: boolean; sort_order: number
}
type RoleDefault = { base_role: string; permission_key: string; default_allowed: boolean; max_allowed: boolean }
type SubRole = { id: string; base_role: string; name: string; is_default: boolean; archived_at: string | null }
type SubRolePerm = { sub_role_id: string; permission_key: string; allowed: boolean }

// Roles this page can ever show. 'coordinator' is excluded — it always has
// everything and short-circuits in resolution, so a coordinator row would
// be either a no-op or, if misused, a way to lock the org out of its own
// settings page.
const DISPLAYABLE_ROLES = ['family', 'recipient', 'support_worker', 'therapist']

export default function PermissionsPage() {
  const navigate = useNavigate()
  const { profile, org } = useAuth()
  const qc = useQueryClient()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [expandedSubRole, setExpandedSubRole] = useState<string | null>(null)
  const [newSubRoleName, setNewSubRoleName] = useState('')
  const [creatingFor, setCreatingFor] = useState<string | null>(null)

  const isFamilyOrg = org?.org_type === 'family'
  // Therapist is a provider-org-only role — hide it from family plan orgs.
  const roles = DISPLAYABLE_ROLES.filter((r) => !(isFamilyOrg && r === 'therapist'))

  const { data: baseRoles = [] } = useQuery({
    queryKey: ['base-roles'],
    queryFn: async () => {
      const { data } = await supabase.from('base_roles').select('role, label, sub_roles_allowed')
      return (data ?? []) as BaseRole[]
    },
  })

  const { data: permKeys = [] } = useQuery({
    queryKey: ['permission-keys'],
    queryFn: async () => {
      const { data } = await supabase.from('permission_keys')
        .select('key, label, description, kind, enforced, sort_order').order('sort_order')
      return (data ?? []) as PermKey[]
    },
  })

  const { data: roleDefaults = [] } = useQuery({
    queryKey: ['role-permission-defaults'],
    queryFn: async () => {
      const { data } = await supabase.from('role_permission_defaults')
        .select('base_role, permission_key, default_allowed, max_allowed')
      return (data ?? []) as RoleDefault[]
    },
  })

  const { data: subRoles = [], isLoading } = useQuery({
    queryKey: ['all-sub-roles', profile?.org_id],
    queryFn: async () => {
      const { data } = await supabase.from('sub_roles')
        .select('id, base_role, name, is_default, archived_at')
        .eq('org_id', profile!.org_id!)
        .order('is_default', { ascending: false })
        .order('name')
      return (data ?? []) as SubRole[]
    },
    enabled: !!profile?.org_id,
  })

  const { data: subRolePerms = [] } = useQuery({
    queryKey: ['all-sub-role-permissions', profile?.org_id],
    queryFn: async () => {
      const ids = subRoles.map((s) => s.id)
      if (ids.length === 0) return []
      const { data } = await supabase.from('sub_role_permissions')
        .select('sub_role_id, permission_key, allowed')
        .in('sub_role_id', ids)
      return (data ?? []) as SubRolePerm[]
    },
    enabled: subRoles.length > 0,
  })

  function defaultFor(baseRole: string, key: string) {
    return roleDefaults.find((d) => d.base_role === baseRole && d.permission_key === key)
  }

  function resolvedFor(subRoleId: string, baseRole: string, key: string): boolean {
    const override = subRolePerms.find((p) => p.sub_role_id === subRoleId && p.permission_key === key)
    const def = defaultFor(baseRole, key)
    if (!def) return false
    return (override ? override.allowed : def.default_allowed) && def.max_allowed
  }

  async function toggleSubRolePerm(subRole: SubRole, key: string, next: boolean) {
    setBusyKey(subRole.id + key)
    setError('')
    const permissions: Record<string, boolean> = {}
    for (const k of permKeys) permissions[k.key] = k.key === key ? next : resolvedFor(subRole.id, subRole.base_role, k.key)
    // update_sub_role fully replaces a sub-role's invitable-roles set, so it
    // must be re-derived here rather than sent empty — otherwise toggling
    // any unrelated permission would silently wipe an existing invite
    // grant. support_worker's invite_ceiling only ever contains
    // 'support_worker' (invite-a-worker is the only breadth this base role
    // can have), so "invite_members on" <=> "can invite support_worker".
    const invitableRoles = permissions.invite_members ? ['support_worker'] : []
    const { error } = await supabase.rpc('update_sub_role', {
      p_id: subRole.id, p_name: subRole.name, p_permissions: permissions, p_invitable_roles: invitableRoles,
    })
    setBusyKey(null)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['all-sub-role-permissions'] })
    qc.invalidateQueries({ queryKey: ['my-permissions'] })
  }

  async function createSubRole(baseRole: string) {
    if (!newSubRoleName.trim()) return
    setBusyKey('create')
    setError('')
    const { error } = await supabase.rpc('create_sub_role', {
      p_base_role: baseRole, p_name: newSubRoleName.trim(), p_permissions: {}, p_invitable_roles: [],
    })
    setBusyKey(null)
    if (error) { setError(error.message); return }
    setNewSubRoleName('')
    setCreatingFor(null)
    qc.invalidateQueries({ queryKey: ['all-sub-roles'] })
  }

  async function archiveSubRole(subRole: SubRole) {
    if (!confirm(`Remove the "${subRole.name}" type? Anyone currently assigned to it keeps their permissions until reassigned.`)) return
    setBusyKey(subRole.id)
    setError('')
    const targetDefault = subRoles.find((s) => s.base_role === subRole.base_role && s.is_default)
    const { error } = targetDefault
      ? await supabase.rpc('delete_sub_role', { p_id: subRole.id, p_reassign_to: targetDefault.id })
      : { error: { message: 'No default type to reassign to' } }
    setBusyKey(null)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['all-sub-roles'] })
    qc.invalidateQueries({ queryKey: ['org-members'] })
  }

  if (profile?.role !== 'coordinator') {
    return (
      <div className="page" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <p style={{ color: 'var(--color-muted)' }}>Only coordinators can manage permissions.</p>
        <button className="btn btn-ghost" onClick={() => navigate(-1)} style={{ marginTop: '1rem' }}>← Back</button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={{
        padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <div>
          <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Permissions</h1>
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-muted)' }}>
            Control what each role can do
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '1rem' }}>
        <div className="card" style={{ marginBottom: '1rem', background: '#f0faf6', border: '1px solid #b2dfc9' }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#2d5a3d', lineHeight: 1.6 }}>
            <strong>Coordinator</strong> always has full access to everything. Changes below take effect immediately.
          </p>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
          </div>
        ) : (
          roles.map((roleKey) => {
            const roleMeta = baseRoles.find((b) => b.role === roleKey)
            const roleSubRoles = subRoles.filter((s) => s.base_role === roleKey && !s.archived_at)

            // family / recipient / therapist have no sub-role mechanism yet
            // (PO decision: support_worker only, this pass) — show their
            // fixed floor read-only rather than a control that can't save.
            if (!roleMeta?.sub_roles_allowed) {
              return (
                <div key={roleKey} className="card" style={{ marginBottom: '1rem' }}>
                  <h2 style={{ margin: '0 0 0.25rem', fontSize: '0.9375rem', fontWeight: 600 }}>
                    {roleMeta?.label ?? roleKey}
                  </h2>
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                    Fixed for this role — not yet individually configurable.
                  </p>
                  {permKeys.map((k, i) => {
                    const def = defaultFor(roleKey, k.key)
                    const isOn = !!def && def.default_allowed && def.max_allowed
                    return (
                      <PermRow key={k.key} permKey={k} isOn={isOn} disabled first={i === 0} />
                    )
                  })}
                </div>
              )
            }

            return (
              <div key={roleKey} className="card" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>{roleMeta.label}</h2>
                  <button className="btn btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                    onClick={() => setCreatingFor(creatingFor === roleKey ? null : roleKey)}>
                    + Add type
                  </button>
                </div>

                {creatingFor === roleKey && (
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <input className="input" placeholder="e.g. Trusted worker" value={newSubRoleName}
                      onChange={(e) => setNewSubRoleName(e.target.value)} style={{ flex: 1, fontSize: '0.85rem' }} autoFocus />
                    <button className="btn btn-primary" style={{ fontSize: '0.8rem' }}
                      disabled={busyKey === 'create' || !newSubRoleName.trim()}
                      onClick={() => createSubRole(roleKey)}>
                      {busyKey === 'create' ? <span className="spinner" /> : 'Create'}
                    </button>
                  </div>
                )}

                {roleSubRoles.map((sr) => {
                  const expanded = expandedSubRole === sr.id
                  return (
                    <div key={sr.id} style={{ marginBottom: '0.5rem', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                      <button
                        onClick={() => setExpandedSubRole(expanded ? null : sr.id)}
                        style={{
                          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          background: 'none', border: 'none', padding: '0.6rem 0.75rem', cursor: 'pointer', textAlign: 'left',
                        }}
                      >
                        <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                          {sr.name}{sr.is_default ? ' (default)' : ''}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {!sr.is_default && (
                            <span
                              role="button" tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); archiveSubRole(sr) }}
                              style={{ fontSize: '0.72rem', color: 'var(--color-danger, #c0392b)' }}
                            >
                              {busyKey === sr.id ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Remove'}
                            </span>
                          )}
                          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{expanded ? '▲' : '▼'}</span>
                        </span>
                      </button>
                      {expanded && (
                        <div style={{ padding: '0 0.75rem 0.5rem' }}>
                          {permKeys.map((k, i) => {
                            const def = defaultFor(roleKey, k.key)
                            const isOn = resolvedFor(sr.id, roleKey, k.key)
                            const ceilingBlocked = !!def && !def.max_allowed
                            return (
                              <PermRow
                                key={k.key} permKey={k} isOn={isOn}
                                disabled={ceilingBlocked || busyKey === sr.id + k.key}
                                disabledReason={ceilingBlocked ? 'Not available for this role' : undefined}
                                first={i === 0}
                                onToggle={() => toggleSubRolePerm(sr, k.key, !isOn)}
                                busy={busyKey === sr.id + k.key}
                              />
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function PermRow({
  permKey, isOn, disabled, disabledReason, first, onToggle, busy,
}: {
  permKey: PermKey
  isOn: boolean
  disabled?: boolean
  disabledReason?: string
  first?: boolean
  onToggle?: () => void
  busy?: boolean
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0.6rem 0', borderTop: first ? 'none' : '1px solid var(--color-border)', gap: '1rem',
    }}>
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 500 }}>
          {permKey.label}
          {!permKey.enforced && (
            <span style={{ marginLeft: '0.4rem', fontSize: '0.65rem', color: 'var(--color-muted)', fontWeight: 400 }}>
              (not yet enforced)
            </span>
          )}
        </p>
        {permKey.description && (
          <p style={{ margin: '0.1rem 0 0', fontSize: '0.72rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>
            {permKey.description}
          </p>
        )}
        {disabledReason && (
          <p style={{ margin: '0.1rem 0 0', fontSize: '0.7rem', color: 'var(--color-muted)', fontStyle: 'italic' }}>
            {disabledReason}
          </p>
        )}
      </div>
      <button
        onClick={onToggle}
        disabled={disabled || !onToggle}
        style={{
          flexShrink: 0, width: 40, height: 22, borderRadius: 11, border: 'none',
          cursor: disabled || !onToggle ? 'default' : 'pointer', position: 'relative',
          opacity: disabled ? 0.45 : 1, transition: 'background 0.2s',
          background: isOn ? 'var(--color-primary)' : 'var(--color-border)',
        }}
        aria-label={`${isOn ? 'Disable' : 'Enable'} ${permKey.label}`}
      >
        {busy ? (
          <span className="spinner" style={{ width: 12, height: 12, position: 'absolute', top: 5, left: 14 }} />
        ) : (
          <span style={{
            position: 'absolute', top: 2, left: isOn ? 20 : 2,
            width: 18, height: 18, borderRadius: '50%', background: '#fff',
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', display: 'block',
          }} />
        )}
      </button>
    </div>
  )
}
