import { useState } from 'react'
import { useModalOpen } from '../context/ModalActivityContext'
import { supabase } from '../lib/supabase'
import { buildSmsLink } from '../lib/smsLink'

export type SubRole = { id: string; name: string; is_default: boolean }

const ROLE_LABEL: Record<string, string> = {
  coordinator: 'Coordinator',
  family: 'Family member',
  recipient: 'Participant',
  trusted_support_worker: 'Trusted worker',
  support_worker: 'Support worker',
  therapist: 'Therapist',
}

// The plain-language "Who is this person?" picker. Hints say what the
// role can actually SEE and DO, because "family member" vs "support
// worker" is not what a coordinator is deciding between — access is.
const ROLE_CHOICES: { value: string; label: string; hint: string }[] = [
  { value: 'recipient', label: 'The participant themselves', hint: 'Gives the person being supported their own login — they can see and add to the care journal.' },
  { value: 'family', label: 'Family member', hint: 'Adds journal entries and can see the care journal.' },
  { value: 'support_worker', label: 'Support worker', hint: 'Logs shifts and entries, behaviour notes and shift notes.' },
  { value: 'therapist', label: 'Therapist', hint: 'Sees shared notes and adds goals.' },
]

// Roles whose invite is scoped to a participant. 'family'/'recipient' MUST
// name one (a family member or a participant login belongs to exactly one
// participant). Workers CAN optionally be assigned at invite time — they may
// serve several participants over time, so this is just a convenient first
// assignment; more are added later from that participant's "Assigned
// workers" panel. A single-client org has nothing to pick, so no picker
// shows there either way.
const REQUIRED_CLIENT_ROLES = new Set(['family', 'recipient'])
const OPTIONAL_CLIENT_ROLES = new Set(['support_worker', 'trusted_support_worker'])

export default function InviteMemberModal({
  orgId,
  allowedRoles,
  clients,
  subRoles,
  onClose,
  pinnedRole,
  pinnedClientId,
  initialEmail,
  onSent,
}: {
  orgId: string
  allowedRoles: string[]
  clients: { id: string; full_name: string }[]
  subRoles: SubRole[]
  onClose: () => void
  /** Fixes the role — the picker is hidden entirely. */
  pinnedRole?: string
  /** Fixes the participant — the client picker is hidden entirely. */
  pinnedClientId?: string
  initialEmail?: string
  /** Called with the email actually invited, after a successful send. */
  onSent?: (email: string) => void
}) {
  useModalOpen()
  const [name, setName] = useState('')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState(pinnedRole ?? allowedRoles[0] ?? 'support_worker')
  const [subRoleId, setSubRoleId] = useState('')
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [sent, setSent] = useState(false)
  const [sentInviteUrl, setSentInviteUrl] = useState<string | null>(null)
  const [fallbackLink, setFallbackLink] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const required = REQUIRED_CLIENT_ROLES.has(role)
  const optional = OPTIONAL_CLIENT_ROLES.has(role)
  // A pinned participant satisfies every client requirement on its own —
  // callers that pin one (a participant's own page, family setup) pass
  // clients={[]} and must not be told to "add a participant first".
  const needsClientPicker = !pinnedClientId && (required || optional) && clients.length > 1
  const noClients = !pinnedClientId && required && clients.length === 0
  const clientId = pinnedClientId
    ?? (needsClientPicker
      ? (selectedClientId || null)
      : (clients.length === 1 ? clients[0].id : null))

  // Only offer a choice when there is genuinely one to make.
  const showRolePicker = !pinnedRole && allowedRoles.length > 1
  const roleChoices = allowedRoles.map((r) => {
    const known = ROLE_CHOICES.find((c) => c.value === r)
    return known ?? { value: r, label: ROLE_LABEL[r] ?? r, hint: '' }
  })
  const activeHint = roleChoices.find((c) => c.value === role)?.hint ?? ''

  async function handleInvite() {
    if (!name.trim() || !email.trim()) return
    if (required && !clientId) { setErr('Choose which participant this is for.'); return }
    setSaving(true)
    setErr('')
    const trimmedEmail = email.trim()
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: {
        name: name.trim(), email: trimmedEmail, phone: phone.trim() || null, role, org_id: orgId,
        client_id: clientId, sub_role_id: role === 'support_worker' ? (subRoleId || null) : null,
      },
    })
    setSaving(false)
    if (error || !data?.ok) {
      setErr(data?.error ?? error?.message ?? 'Failed to send invite')
      if (data?.inviteUrl) setFallbackLink(data.inviteUrl)
      return
    }
    setSentInviteUrl(data.inviteUrl ?? null)
    setSent(true)
    onSent?.(trimmedEmail)
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

        {showRolePicker && (
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="invite-role">Who is this person?</label>
            <select id="invite-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {roleChoices.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            {activeHint && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
                {activeHint}
              </p>
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

        {role === 'support_worker' && subRoles.length > 0 && (
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="invite-sub-role">Support worker type</label>
            <select id="invite-sub-role" className="input" value={subRoleId} onChange={(e) => setSubRoleId(e.target.value)}>
              {subRoles.map((sr) => (
                <option key={sr.id} value={sr.id}>{sr.name}{sr.is_default ? ' (default)' : ''}</option>
              ))}
            </select>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
              Sets which permissions this worker starts with — manage types in Settings → Permissions.
            </p>
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
