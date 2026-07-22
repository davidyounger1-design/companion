import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { useModalOpen } from '../../context/ModalActivityContext'
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

// Roles whose invite is scoped to a participant. 'family'/'recipient' MUST
// name one (a family member or a recipient login belongs to exactly one
// participant). Workers CAN optionally be assigned at invite time — they may
// serve several participants over time, so this is just a convenient first
// assignment; more are added later from that participant's "Assigned
// workers" panel. A single-client org has nothing to pick, so no picker
// shows there either way.
const REQUIRED_CLIENT_ROLES = new Set(['family', 'recipient'])
const OPTIONAL_CLIENT_ROLES = new Set(['support_worker', 'trusted_support_worker'])

function InviteModal({
  orgId,
  allowedRoles,
  clients,
  onClose,
}: {
  orgId: string
  allowedRoles: string[]
  clients: { id: string; full_name: string }[]
  onClose: () => void
}) {
  useModalOpen()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState(allowedRoles[0] ?? 'support_worker')
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [sent, setSent] = useState(false)
  const [sentInviteUrl, setSentInviteUrl] = useState<string | null>(null)
  const [fallbackLink, setFallbackLink] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const required = REQUIRED_CLIENT_ROLES.has(role)
  const optional = OPTIONAL_CLIENT_ROLES.has(role)
  const needsClientPicker = (required || optional) && clients.length > 1
  const noClients = required && clients.length === 0
  // Single-client orgs (every family org, and a provider org with just one
  // active participant) have nothing to choose — use it without a picker.
  // For an optional (worker) picker, an empty selection means "assign later".
  const clientId = needsClientPicker
    ? (selectedClientId || null)
    : (clients.length === 1 ? clients[0].id : null)

  async function handleInvite() {
    if (!name.trim() || !email.trim()) return
    if (required && !clientId) { setErr('Choose which participant this is for.'); return }
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

        {needsClientPicker && (
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="invite-client">
              {required ? 'Which participant is this for?' : 'Assign to a participant (optional)'}
            </label>
            <select id="invite-client" className="input" value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}>
              {optional && <option value="">— assign later —</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
            {optional && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
                Workers can be assigned to more participants later from each participant's page.
              </p>
            )}
          </div>
        )}
        {noClients && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            Add a participant before inviting their {role === 'recipient' ? 'own login' : 'family'}.
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleInvite}
            disabled={saving || !name.trim() || !email.trim() || noClients} style={{ flex: 2 }}>
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
        .select('id, name, email, phone, role, token, client_id, created_at')
        .eq('org_id', profile!.org_id!)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      return data ?? []
    },
    enabled: !!profile?.org_id && ['coordinator', 'family', 'trusted_support_worker'].includes(profile?.role ?? ''),
  })

  // Every active participant in the org — used to let the coordinator pick
  // which one a family/recipient invite is for. A "first active client" guess
  // silently mis-attached invites the moment an org had more than one.
  const { data: orgClients = [], isLoading: orgClientsLoading } = useQuery({
    queryKey: ['org-clients', profile?.org_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, full_name')
        .eq('org_id', profile!.org_id!)
        .eq('active', true)
        .order('full_name')
      return data ?? []
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

  async function resendInvite(invite: { id: string; email: string; role: string; phone?: string | null; name?: string | null; client_id?: string | null }) {
    if (!org) return
    setResendingId(invite.id)
    try {
      // Reuse the SAME participant the invite was originally sent for — never
      // re-guess (that's the bug this whole flow used to have).
      await supabase.functions.invoke('invite-member', {
        body: { name: invite.name ?? null, email: invite.email, phone: invite.phone ?? null, role: invite.role, org_id: org.id, client_id: invite.client_id ?? null },
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

  // Seat quota: seats/metered_axis are synced onto org by reconcileOrgPlan at
  // login — read directly (no extra round trip, no loading race). The DB
  // trigger on `clients` (migration 055) is the real backstop for participant
  // records; this is client-side-only for worker/recipient invites for now.
  // FAIL OPEN — if seats/axis are unset, never block adding staff.
  const meteredAxis = org?.metered_axis ?? null
  const seats = org?.seats ?? null
  const workerCount = members.filter((m) => m.role === 'support_worker' || m.role === 'trusted_support_worker').length
  const recipientCount = members.filter((m) => m.role === 'recipient').length
  const workerCapReached = meteredAxis === 'workers' && seats != null && workerCount >= seats
  const recipientCapReached = meteredAxis === 'participants' && seats != null && recipientCount >= seats
  const capNote = workerCapReached
    ? `You've reached your plan's limit of ${seats} worker${seats === 1 ? '' : 's'}. Increase your plan quantity to add more.`
    : recipientCapReached
    ? `You've reached your plan's limit of ${seats} participant${seats === 1 ? '' : 's'}. Increase your plan quantity to add more.`
    : ''

  // Roles the current user is allowed to invite
  const invitableRoles: string[] = (() => {
    const roles = (() => {
      if (isCoordinator) {
        // A participant's family is the same concept on every plan — they can
        // see their own participant's data whether the org is family or
        // provider — so 'family' is always invitable, not just on family orgs.
        return ['family', 'recipient', 'support_worker', 'trusted_support_worker', 'therapist']
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
    // Drop roles the plan doesn't include (care-recipient login, therapist
    // circles) or that are at their seat quota (workers / participants).
    return roles.filter((r) => {
      if (r === 'recipient' && !canInviteRecipient) return false
      if (r === 'therapist' && !canInviteTherapist) return false
      if ((r === 'support_worker' || r === 'trusted_support_worker') && workerCapReached) return false
      if (r === 'recipient' && recipientCapReached) return false
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
            disabled={orgClientsLoading} style={{ fontSize: '0.875rem' }}>
            {orgClientsLoading ? <span className="spinner" /> : '+ Invite'}
          </button>
        )}
      </div>

      <div style={{ maxWidth: 540, margin: '0 auto', padding: '1rem' }}>
        {capNote && (
          <div className="alert" style={{ marginBottom: '1rem', background: 'color-mix(in srgb, var(--color-primary) 10%, transparent)', color: 'var(--color-primary-deep)' }}>{capNote}</div>
        )}
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
          clients={orgClients}
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
  useModalOpen()
  const [fullName, setFullName] = useState(member.full_name)
  const [phone, setPhone] = useState(member.phone ?? '')
  const [email, setEmail] = useState(member.email ?? '')
  const [showPasswordField, setShowPasswordField] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function handleSave() {
    if (!fullName.trim()) { setErr('Name is required'); return }
    if (showPasswordField && newPassword.length > 0 && newPassword.length < 6) {
      setErr('New password must be at least 6 characters')
      return
    }
    setSaving(true)
    setErr('')

    const { data, error } = await supabase.rpc('update_member', {
      p_user_id: member.id,
      p_full_name: fullName.trim(),
      p_phone: phone.trim() || null,
    })
    const r = data as RpcResult | null
    if (error || !r?.ok) {
      setSaving(false)
      setErr(r?.error ?? error?.message ?? 'Could not save')
      return
    }

    // Email lives on auth.users, not profiles — a separate admin-only call.
    const trimmedEmail = email.trim().toLowerCase()
    if (member.email && trimmedEmail !== member.email.toLowerCase()) {
      const { data: emailData, error: emailErr } = await supabase.functions.invoke('update-member-email', {
        body: { user_id: member.id, new_email: trimmedEmail },
      })
      if (emailErr || !emailData?.ok) {
        setSaving(false)
        setErr(emailData?.error ?? emailErr?.message ?? 'Could not update email')
        return
      }
    }

    if (showPasswordField && newPassword) {
      const { data: pwData, error: pwErr } = await supabase.functions.invoke('update-member-password', {
        body: { user_id: member.id, new_password: newPassword },
      })
      setSaving(false)
      if (pwErr || !pwData?.ok) { setErr(pwData?.error ?? pwErr?.message ?? 'Could not update password'); return }
      onSaved()
      return
    }

    setSaving(false)
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
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="edit-email">Email address</label>
            <input id="edit-email" type="email" className="input" value={email}
              onChange={(e) => setEmail(e.target.value)} />
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
              Changes their login email immediately — no confirmation needed from them.
            </p>
          </div>
        )}

        <div style={{ marginBottom: '1rem' }}>
          {!showPasswordField ? (
            <button className="btn btn-ghost" style={{ fontSize: '0.85rem', padding: '0.3rem 0' }}
              onClick={() => setShowPasswordField(true)}>
              Set a new password…
            </button>
          ) : (
            <div className="field">
              <label htmlFor="edit-member-password">New password</label>
              <input id="edit-member-password" type="password" className="input"
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
                Takes effect immediately — no confirmation from them, and they won't be signed out of other devices.
              </p>
            </div>
          )}
        </div>

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
