import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { DEFAULT_PERMS, type PermissionKey, type RolePerms, type PermissionsMap } from '../../hooks/usePermissions'

const ALL_CONFIGURABLE_ROLES = [
  { key: 'family', label: 'Family member', icon: '👨‍👩‍👧' },
  { key: 'trusted_support_worker', label: 'Trusted support worker', icon: '⭐' },
  { key: 'support_worker', label: 'Support worker', icon: '👤' },
  { key: 'therapist', label: 'Therapist / allied health', icon: '🩺' },
]

// Notices are coordinator-only and not configurable here — see migration
// 057's INSERT policy on `notices`.
const PERMISSION_LABELS: Record<PermissionKey, { label: string; description: string }> = {
  add_entries: {
    label: 'Add journal entries',
    description: 'Can log new meal, activity, mood and note entries',
  },
  view_all_entries: {
    label: 'View all entries',
    description: 'Can see entries logged by other team members (not just their own)',
  },
  edit_own_entry: {
    label: 'Edit own entries',
    description: 'Can edit entries they personally logged',
  },
  edit_any_entry: {
    label: 'Edit anyone\'s entries',
    description: 'Can edit entries logged by any team member',
  },
  send_messages: {
    label: 'Send messages',
    description: 'Can send direct messages to other members',
  },
  invite_members: {
    label: 'Invite members',
    description: 'Can send invitations — coordinators & family can invite any role; workers can only invite other support workers',
  },
}

const PERM_KEYS: PermissionKey[] = [
  'add_entries',
  'view_all_entries',
  'edit_own_entry',
  'edit_any_entry',
  'send_messages',
  'invite_members',
]

export default function PermissionsPage() {
  const navigate = useNavigate()
  const { profile, org } = useAuth()
  const qc = useQueryClient()

  const isFamilyOrg = org?.org_type === 'family'
  // Therapist is a provider-org-only role — hide it from family plan
  const CONFIGURABLE_ROLES = isFamilyOrg
    ? ALL_CONFIGURABLE_ROLES.filter(r => r.key !== 'therapist')
    : ALL_CONFIGURABLE_ROLES
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const { data: storedPerms = {}, isLoading } = useQuery({
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
  })

  // Merge stored overrides onto defaults for editing
  const [localPerms, setLocalPerms] = useState<PermissionsMap | null>(null)

  const effective: PermissionsMap = localPerms ?? (() => {
    const merged: PermissionsMap = {}
    for (const { key } of CONFIGURABLE_ROLES) {
      merged[key] = { ...DEFAULT_PERMS[key], ...(storedPerms[key] ?? {}) }
    }
    return merged
  })()

  function toggle(role: string, perm: PermissionKey) {
    const base = localPerms ?? (() => {
      const m: PermissionsMap = {}
      for (const { key } of CONFIGURABLE_ROLES) {
        m[key] = { ...DEFAULT_PERMS[key], ...(storedPerms[key] ?? {}) }
      }
      return m
    })()
    setLocalPerms({
      ...base,
      [role]: { ...(base[role] ?? {}), [perm]: !(base[role] as RolePerms)?.[perm] },
    })
    setSaved(false)
  }

  async function save() {
    if (!profile?.org_id) return
    setSaving(true)
    // Upsert into org_settings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('org_settings') as any)
      .upsert({ org_id: profile.org_id, permissions: effective }, { onConflict: 'org_id' })
    setSaving(false)
    if (!error) {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['org-permissions', profile.org_id] })
      setTimeout(() => setSaved(false), 3000)
    }
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
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn-ghost" onClick={() => navigate(-1)}
            style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
          <div>
            <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Permissions</h1>
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-muted)' }}>
              Control what each role can do
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {saved && <span style={{ fontSize: '0.8rem', color: 'var(--color-primary)' }}>✓ Saved</span>}
          <button className="btn btn-primary" onClick={save} disabled={saving}
            style={{ fontSize: '0.875rem' }}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '1rem' }}>
        <div className="card" style={{ marginBottom: '1rem', background: '#f0faf6', border: '1px solid #b2dfc9' }}>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#2d5a3d', lineHeight: 1.6 }}>
            <strong>Coordinator</strong> always has full access to everything — these settings only apply to other roles.
            Changes take effect immediately after saving.
          </p>
        </div>

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
          </div>
        ) : (
          CONFIGURABLE_ROLES.map(({ key: roleKey, label, icon }) => (
            <div key={roleKey} className="card" style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <span style={{ fontSize: '1.2rem' }}>{icon}</span>
                <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600 }}>{label}</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {PERM_KEYS.map((perm, i) => {
                  const { label: permLabel, description } = PERMISSION_LABELS[perm]
                  const isOn = (effective[roleKey] as RolePerms)?.[perm] ?? DEFAULT_PERMS[roleKey]?.[perm] ?? false
                  return (
                    <div key={perm} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.75rem 0',
                      borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                      gap: '1rem',
                    }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 500 }}>{permLabel}</p>
                        <p style={{ margin: '0.15rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)', lineHeight: 1.4 }}>
                          {description}
                        </p>
                      </div>
                      <button
                        onClick={() => toggle(roleKey, perm)}
                        style={{
                          flexShrink: 0, width: 44, height: 24, borderRadius: 12, border: 'none',
                          cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                          background: isOn ? 'var(--color-primary)' : 'var(--color-border)',
                        }}
                        aria-label={`${isOn ? 'Disable' : 'Enable'} ${permLabel} for ${label}`}
                      >
                        <span style={{
                          position: 'absolute', top: 2, left: isOn ? 22 : 2,
                          width: 20, height: 20, borderRadius: '50%', background: '#fff',
                          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          display: 'block',
                        }} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
