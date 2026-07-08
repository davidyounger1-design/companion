import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../hooks/usePermissions'
import { useFeatures } from '../../hooks/useFeatures'
import { FEATURES } from '../../lib/features'
import { buildSmsLink } from '../../lib/smsLink'

type OrgMember = { id: string; full_name: string; role: string; email?: string; phone?: string | null }

type RpcResult = { ok: boolean; error?: string; new_role?: string }

const ROLE_LABEL: Record<string, string> = {
  coordinator: 'Coordinator',
  family: 'Family member',
  recipient: 'Care recipient',
  trusted_support_worker: 'Trusted worker',
  support_worker: 'Support worker',
  therapist: 'Therapist',
}

const ROLE_ORDER = ['coordinator', 'family', 'recipient', 'trusted_support_worker', 'support_worker', 'therapist']

function roleBadgeStyle(role: string): React.CSSProperties {
  const map: Record<string, string> = {
    coordinator: 'var(--color-primary)',
    family: '#7c6be8',
    recipient: '#1a73c0',
    trusted_support_worker: '#2e7d52',
    support_worker: 'var(--color-muted)',
    therapist: '#c06b1a',
  }
  return {
    display: 'inline-block',
    padding: '0.15rem 0.5rem',
    borderRadius: 4,
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    background: `color-mix(in srgb, ${map[role] ?? 'var(--color-muted)'} 12%, transparent)`,
    color: map[role] ?? 'var(--color-muted)',
  }
}

function InviteModal({
  orgId,
  allowedRoles,
  clientId,
  onClose,
}: {
  orgId: string
  allowedRoles: string[]
  clientId: string | null
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState(allowedRoles[0] ?? 'support_worker')
  const [saving, setSaving] = useState(false)
  const [sent, setSent] = useState(false)
  const [sentInviteUrl, setSentInviteUrl] = useState<string | null>(null)
  const [fallbackLink, setFallbackLink] = useState<string | null>(null)
  const [err, setErr] = useState('')

  async function handleInvite() {
    if (!name.trim() || !email.trim()) return
    setSaving(true)
    setErr('')
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: { name: name.trim(), email: email.trim(), phone: phone.trim() || null, role, org_id: orgId, client_id: clientId },
    })
    setSaving(false)
    if (error || !data?.ok) {
      setErr(data?.error ?? error?.message ?? 'Failed to send invite')
      if (data?.inviteUrl) setFallbackLink(data.inviteUrl)
      return
    }
    setSentInviteUrl(data.inviteUrl ?? null)
    setSent(true)
  }

  if (sent) {
    const smsHref = phone.trim() && sentInviteUrl
      ? buildSmsLink(phone.trim(), `You've been invited to join Companion — tap to accept: ${sentInviteUrl}`)
      : null
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✉️</div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 400, marginBottom: '0.5rem' }}>Invite sent</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
            An email has been sent to <strong>{name}</strong> ({email}).<br />
            They'll click the link, create a password, and land straight in the journal.
          </p>
          {smsHref && (
            <a href={smsHref} className="btn btn-secondary btn-full" style={{ marginBottom: '0.75rem' }}>
              📱 Also text the invite to {phone.trim()}
            </a>
          )}
          <button className="btn btn-primary btn-full" onClick={onClose}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Invite member</p>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 400, marginBottom: '1.25rem' }}>Send an invitation</h2>

        {err && (
          <div style={{ marginBottom: '1rem' }}>
            <div className="alert alert-error">{err}</div>
            {fallbackLink && (
              <div style={{ marginTop: '0.75rem' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.4rem' }}>
                  Share this link manually instead:
                </p>
                <div style={{
                  background: 'var(--color-surface)', borderRadius: 8,
                  padding: '0.6rem 0.75rem', fontSize: '0.75rem', wordBreak: 'break-all',
                  border: '1px solid var(--color-border)', marginBottom: '0.4rem',
                }}>
                  {fallbackLink}
                </div>
                <button className="btn btn-ghost" style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                  onClick={() => navigator.clipboard.writeText(fallbackLink!).catch(() => {})}>
                  Copy link
                </button>
              </div>
            )}
          </div>
        )}

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="invite-name">Their name</label>
          <input id="invite-name" className="input" placeholder="e.g. Sarah Younger"
            value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="invite-email">Email address</label>
          <input id="invite-email" type="email" className="input" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="invite-phone">
            Mobile number <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <input id="invite-phone" type="tel" className="input" placeholder="04xx xxx xxx"
            value={phone} onChange={(e) => setPhone(e.target.value)} />
          <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
            The invite is always emailed. Add a number to also get a one-tap link for texting it yourself.
          </p>
        </div>

        {allowedRoles.length > 1 && (
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="invite-role">Role</label>
            <select id="invite-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {allowedRoles.map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleInvite}
            disabled={saving || !name.trim() || !email.trim()} style={{ flex: 2 }}>
            {saving ? <span className="spinner" /> : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MembersPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, profile, org } = useAuth()
  const [showInvite, setShowInvite] = useState(false)
  const [editMember, setEditMember] = useState<OrgMember | null>(null)
  const [actionError, setActionError] = useState('')
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [rescindingId, setRescindingId] = useState<string | null>(null)

  const perms = usePermissions()
  const { has } = useFeatures()
  // Care-recipient login is a plan-selectable feature. FAIL CLOSED: unless the
  // subscription includes it, no one can invite/create a recipient account.
  const canInviteRecipient = has(FEATURES.recipientLogin)
  // Therapist invites seed a care circle — a therapy_circles plan feature.
  const canInviteTherapist = has(FEATURES.therapyCircles)
  const isCoordinator = profile?.role === 'coordinator'
  const isFamily = profile?.role === 'family'
  const isFamilyOrg = org?.org_type === 'family'

  const { data: members = [], isLoading } = useQuery({
    queryKey: ['org-members', profile?.org_id],
    queryFn: async () => {
      const rpc = await supabase.rpc('get_org_members')
      if (!rpc.error) return (rpc.data ?? []) as OrgMember[]
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, phone')
        .eq('org_id', profile!.org_id!)
        .order('role')
        .order('full_name')
      if (error) throw error
      return (data ?? []) as OrgMember[]
    },
    enabled: !!profile?.org_id,
  })

  const { data: pendingInvites = [] } = useQuery({
    queryKey: ['pending-invites', profile?.org_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('invites')
        .select('id, name, email, phone, role, token, created_at')
        .eq('org_id', profile!.org_id!)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!profile?.org_id && ['coordinator', 'family', 'trusted_support_worker'].includes(profile?.role ?? ''),
  })

  const { data: firstClient, isLoading: firstClientLoading } = useQuery({
    queryKey: ['first-client', profile?.org_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('id')
        .eq('org_id', profile!.org_id!)
        .eq('active', true)
        .limit(1)
        .maybeSingle()
      return data
    },
    enabled: !!profile?.org_id,
  })

  async function promote(memberId: string, newRole: string) {
    setActionError('')
    const { data } = await supabase.rpc('promote_member', { p_user_id: memberId, p_new_role: newRole })
    const r = data as RpcResult | null
    if (!r?.ok) { setActionError(r?.error ?? 'Promotion failed'); return }
    qc.invalidateQueries({ queryKey: ['org-members'] })
  }

  async function demote(memberId: string) {
    setActionError('')
    const { data } = await supabase.rpc('demote_member', { p_user_id: memberId })
    const r = data as RpcResult | null
    if (!r?.ok) { setActionError(r?.error ?? 'Demotion failed'); return }
    qc.invalidateQueries({ queryKey: ['org-members'] })
  }

  const REMOVE_ERRORS: Record<string, string> = {
    unauthorized: 'Only coordinators can remove members.',
    not_in_your_org: 'That member isn\'t part of your organisation.',
    last_coordinator: 'You can\'t remove the last coordinator — promote someone else first.',
  }

  async function remove(memberId: string) {
    if (!confirm('Remove this member from the organisation? This will also delete their login account.')) return
    setActionError('')
    // delete-member now does the org-scoped authorization, the last-coordinator
    // guard, AND the cascade cleanup itself (deleting the auth user cascades the
    // profile and every client linkage), so it's the single removal path — the
    // old remove_member pre-detach would nil org_id and defeat the auth check.
    const { data, error } = await supabase.functions.invoke('delete-member', { body: { user_id: memberId } })
    if (error || !data?.ok) {
      setActionError(REMOVE_ERRORS[data?.error] ?? data?.error ?? error?.message ?? 'Removal failed')
      return
    }
    qc.invalidateQueries({ queryKey: ['org-members'] })
  }

  async function resendInvite(invite: { id: string; email: string; role: string; phone?: string | null; name?: string | null }) {
    if (!org || !firstClient) return
    setResendingId(invite.id)
    try {
      await supabase.functions.invoke('invite-member', {
        body: { name: invite.name ?? null, email: invite.email, phone: invite.phone ?? null, role: invite.role, org_id: org.id, client_id: firstClient.id },
      })
      qc.invalidateQueries({ queryKey: ['pending-invites'] })
    } finally {
      setResendingId(null)
    }
  }

  async function rescindInvite(invite: { id: string; email: string }) {
    if (!confirm(`Rescind the invite for ${invite.email}? Their invite link will stop working.`)) return
    setActionError('')
    setRescindingId(invite.id)
    try {
      // RLS scopes this to the caller's own org + coordinator role.
      const { error } = await supabase.from('invites').delete().eq('id', invite.id)
      if (error) { setActionError(error.message || 'Could not rescind invite'); return }
      qc.invalidateQueries({ queryKey: ['pending-invites'] })
    } finally {
      setRescindingId(null)
    }
  }

  // Roles the current user is allowed to invite
  const invitableRoles: string[] = (() => {
    const roles = (() => {
      if (isCoordinator) {
        // Coordinator can always invite; family org includes 'family' role
        return isFamilyOrg
          ? ['family', 'recipient', 'support_worker', 'trusted_support_worker', 'therapist']
          : ['recipient', 'support_worker', 'trusted_support_worker', 'therapist']
      }
      if (!perms.invite_members) return []
      // Family members can invite the same set as a coordinator, including the recipient
      // (trusted workers keep the prior set — they can't invite a recipient)
      if (profile?.role === 'family') {
        return ['family', 'recipient', 'support_worker', 'trusted_support_worker', 'therapist']
      }
      if (profile?.role === 'trusted_support_worker') {
        return ['family', 'support_worker', 'trusted_support_worker']
      }
      return ['support_worker']
    })()
    // Drop roles the plan doesn't include: care-recipient login, therapist circles.
    return roles.filter((r) => {
      if (r === 'recipient' && !canInviteRecipient) return false
      if (r === 'therapist' && !canInviteTherapist) return false
      return true
    })
  })()

  const grouped = ROLE_ORDER.reduce<Record<string, OrgMember[]>>((acc, r) => {
    const inRole = members.filter((m) => m.role === r)
    if (inRole.length) acc[r] = inRole
    return acc
  }, {})

  const coordinatorCount = members.filter((m) => m.role === 'coordinator').length
  const isOrgOwner = (memberId: string) => !!org?.owner_id && org.owner_id === memberId

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 1rem 0.75rem', borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button className="btn btn-ghost" onClick={() => navigate(-1)}
            style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
          <h1 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0 }}>Members</h1>
        </div>
        {invitableRoles.length > 0 && (
          <button className="btn btn-primary" onClick={() => setShowInvite(true)}
            disabled={firstClientLoading} style={{ fontSize: '0.875rem' }}>
            {firstClientLoading ? <span className="spinner" /> : '+ Invite'}
          </button>
        )}
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto', padding: '1rem' }}>
        {actionError && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{actionError}</div>
        )}

        {/* Pending invites — coordinators can act on them; family sees them read-only */}
        {(isCoordinator || isFamily) && pendingInvites.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <p style={{
              fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: 'var(--color-muted)', margin: '0 0 0.5rem',
            }}>Pending invites</p>
            {pendingInvites.map((inv: any) => (
              <div key={inv.id} className="card card-sm" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: '0.5rem', opacity: 0.8, gap: '0.5rem',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: 0, fontSize: '0.9rem', fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{inv.name ?? inv.email}</p>
                  {inv.name && (
                    <p style={{
                      margin: '0.05rem 0 0.3rem', fontSize: '0.75rem', color: 'var(--color-muted)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{inv.email}</p>
                  )}
                  <span style={roleBadgeStyle(inv.role)}>{ROLE_LABEL[inv.role] ?? inv.role}</span>
                </div>
                {isCoordinator ? (
                  <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0, alignItems: 'center' }}>
                    {inv.phone && (
                      <a className="btn btn-ghost" title={`Text invite to ${inv.phone}`}
                        style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                        href={buildSmsLink(inv.phone, `You've been invited to join Companion — tap to accept: ${window.location.origin}/accept-invite?token=${inv.token}`)}>
                        📱
                      </a>
                    )}
                    <button className="btn btn-ghost" title="Resend invite"
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', whiteSpace: 'nowrap' }}
                      disabled={resendingId === inv.id || rescindingId === inv.id}
                      onClick={() => resendInvite(inv)}>
                      {resendingId === inv.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '↩'}
                    </button>
                    <button className="btn btn-ghost" title="Cancel invite"
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem', color: 'var(--color-danger, #c0392b)' }}
                      disabled={resendingId === inv.id || rescindingId === inv.id}
                      onClick={() => rescindInvite(inv)}>
                      {rescindingId === inv.id ? <span className="spinner" style={{ width: 14, height: 14 }} /> : '✕'}
                    </button>
                  </div>
                ) : (
                  <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', flexShrink: 0 }}>Pending</span>
                )}
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
          </div>
        ) : (
          Object.entries(grouped).map(([role, roleMembers]) => (
            <div key={role} style={{ marginBottom: '1.5rem' }}>
              <p style={{
                fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--color-muted)', margin: '0 0 0.5rem',
              }}>
                {ROLE_LABEL[role] ?? role}s
              </p>
              {roleMembers.map((m) => (
                <div key={m.id} className="card card-sm" style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: '0.5rem', gap: '0.5rem',
                }}>
                  {/* Avatar + info */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-primary)', flexShrink: 0,
                    }}>
                      {m.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      {/* Name row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <p style={{ margin: 0, fontWeight: 500, fontSize: '0.9375rem' }}>{m.full_name}</p>
                        {m.id === user?.id && (
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)' }}>you</span>
                        )}
                        {isOrgOwner(m.id) && (
                          <span style={{
                            fontSize: '0.62rem', color: 'var(--color-primary)', fontWeight: 700,
                            padding: '0.1rem 0.4rem', border: '1px solid currentColor',
                            borderRadius: 4, letterSpacing: '0.05em', textTransform: 'uppercase',
                          }}>Owner</span>
                        )}
                      </div>
                      {/* Email */}
                      {m.email && (
                        <p style={{ margin: '0.1rem 0 0.2rem', fontSize: '0.75rem', color: 'var(--color-muted)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.email}
                        </p>
                      )}
                      <span style={roleBadgeStyle(m.role)}>{ROLE_LABEL[m.role] ?? m.role}</span>
                    </div>
                  </div>

                  {/* Actions — coordinator only, not for self, not for org owner */}
                  {isCoordinator && (
                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, alignItems: 'center' }}>
                      {/* Edit name/phone — allowed for any member, incl. self & owner */}
                      <button className="btn btn-ghost" onClick={() => setEditMember(m)}
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} title="Edit details">
                        ✏️
                      </button>
                      {/* Role changes + removal — not for self or the org owner */}
                      {m.id !== user?.id && !isOrgOwner(m.id) && (
                        <>
                          {m.role === 'family' && isFamilyOrg && (
                            <button className="btn btn-ghost" onClick={() => promote(m.id, 'coordinator')}
                              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} title="Make coordinator">
                              ↑ Coord
                            </button>
                          )}
                          {m.role === 'support_worker' && (
                            <button className="btn btn-ghost" onClick={() => promote(m.id, 'trusted_support_worker')}
                              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} title="Make trusted worker">
                              ↑ Trust
                            </button>
                          )}
                          {m.role === 'coordinator' && isFamilyOrg && coordinatorCount > 1 && (
                            <button className="btn btn-ghost" onClick={() => demote(m.id)}
                              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} title="Demote to family member">
                              ↓
                            </button>
                          )}
                          {m.role === 'trusted_support_worker' && (
                            <button className="btn btn-ghost" onClick={() => demote(m.id)}
                              style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }} title="Demote to support worker">
                              ↓
                            </button>
                          )}
                          <button className="btn btn-ghost" onClick={() => remove(m.id)}
                            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', color: 'var(--color-danger, #c0392b)' }}
                            title="Remove member">
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}

        {!isLoading && members.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-muted)' }}>
            <p>No members yet. Invite someone to get started.</p>
          </div>
        )}
      </div>

      {showInvite && org && (
        <InviteModal
          orgId={org.id}
          allowedRoles={invitableRoles}
          clientId={firstClient?.id ?? null}
          onClose={() => {
            setShowInvite(false)
            qc.invalidateQueries({ queryKey: ['org-members'] })
            qc.invalidateQueries({ queryKey: ['pending-invites'] })
          }}
        />
      )}

      {editMember && (
        <EditMemberModal
          member={editMember}
          onClose={() => setEditMember(null)}
          onSaved={() => {
            setEditMember(null)
            qc.invalidateQueries({ queryKey: ['org-members'] })
          }}
        />
      )}
    </div>
  )
}

function EditMemberModal({
  member,
  onClose,
  onSaved,
}: {
  member: OrgMember
  onClose: () => void
  onSaved: () => void
}) {
  const [fullName, setFullName] = useState(member.full_name)
  const [phone, setPhone] = useState(member.phone ?? '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    if (!fullName.trim()) { setErr('Name is required'); return }
    setSaving(true)
    setErr('')
    const { data, error } = await supabase.rpc('update_member', {
      p_user_id: member.id,
      p_full_name: fullName.trim(),
      p_phone: phone.trim() || null,
    })
    setSaving(false)
    const r = data as RpcResult | null
    if (error || !r?.ok) { setErr(r?.error ?? error?.message ?? 'Could not save'); return }
    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Edit member</p>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 400, marginBottom: '1.25rem' }}>{member.full_name}</h2>

        {err && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{err}</div>}

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="edit-name">Full name</label>
          <input id="edit-name" className="input" value={fullName}
            onChange={(e) => setFullName(e.target.value)} autoFocus />
        </div>

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="edit-phone">
            Mobile number <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <input id="edit-phone" type="tel" className="input" placeholder="04xx xxx xxx"
            value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        {member.email && (
          <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
            Email: {member.email} <span style={{ opacity: 0.7 }}>(can't be changed here)</span>
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !fullName.trim()} style={{ flex: 2 }}>
            {saving ? <span className="spinner" /> : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
