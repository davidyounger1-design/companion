import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabase'
import { errorMessage } from '../../../lib/errorMessage'
import { ensureFreeFamilySubscription } from '../../../lib/familyPlan'
import { useFeatures } from '../../../hooks/useFeatures'
import { FEATURES } from '../../../lib/features'

export default function FamilyStep1Participant() {
  const navigate = useNavigate()
  const { user, profile, refreshProfile } = useAuth()
  const { has } = useFeatures()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [sendInvite, setSendInvite] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleContinue() {
    if (!name.trim() || !user) return
    setSaving(true)
    setError('')
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('setup_family_org', {
        p_participant_name: name.trim(),
      })
      if (rpcError) throw rpcError
      // Register the free family plan as a real MAB subscription so its
      // entitlements resolve like any other plan. Best-effort — don't block.
      const result = rpcData as { org_id?: string; client_id?: string } | null
      const orgId = result?.org_id
      const clientId = result?.client_id
      if (orgId && user.email) {
        await ensureFreeFamilySubscription({ email: user.email, name: profile?.full_name ?? '', orgId })
      }
      await refreshProfile()

      // Stamp the email on afterwards: setup_family_org creates the client
      // itself and takes no email parameter. This runs AFTER refreshProfile
      // so the caller's my_org_id() resolves to the org that was just
      // created — before that, RLS on clients rejects the update.
      const trimmedEmail = email.trim().toLowerCase()
      if (clientId && trimmedEmail) {
        const { error: stampErr } = await supabase
          .from('clients')
          .update({ email: trimmedEmail })
          .eq('id', clientId)
          .select('id')
          .single()
        if (stampErr) console.error('[FamilyStep1] could not store participant email:', stampErr)

        if (sendInvite && orgId && has(FEATURES.recipientLogin)) {
          supabase.functions
            .invoke('invite-member', {
              body: {
                email: trimmedEmail,
                name: name.trim(),
                role: 'recipient',
                org_id: orgId,
                client_id: clientId,
              },
            })
            .catch(() => {})
        }

        supabase.functions
          .invoke('offer-email-link', {
            body: { org_id: orgId, email: trimmedEmail, participant_name: name.trim() },
          })
          .catch(() => {})
      }

      navigate('/setup/family/invite')
    } catch (e) {
      setError(errorMessage(e, 'Something went wrong. Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Step 1 of 3</p>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        Who are you caring for?
      </h1>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
        This creates their care journal where you and your family can log their day.
      </p>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>
      )}

      <div className="field" style={{ marginBottom: '1.5rem' }}>
        <label htmlFor="participant-name">Their name</label>
        <input
          id="participant-name"
          className="input"
          placeholder="e.g. Liam"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleContinue()}
          autoFocus
        />
      </div>

      <div className="field" style={{ marginBottom: '1rem' }}>
        <label htmlFor="participant-email">
          Their email address <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
        </label>
        <input
          id="participant-email"
          type="email"
          className="input"
          placeholder="their@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
          Only needed if they'll have their own login, or already use Companion with another plan.
        </p>
      </div>

      {has(FEATURES.recipientLogin) && (
        <div className="field" style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="participant-send-invite" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400 }}>
            <input
              id="participant-send-invite"
              type="checkbox"
              checked={sendInvite}
              onChange={e => setSendInvite(e.target.checked)}
              disabled={!email.trim()}
            />
            Send them a login invite now
          </label>
        </div>
      )}

      <button
        className="btn btn-primary btn-full"
        onClick={handleContinue}
        disabled={!name.trim() || saving}
        style={{ fontSize: '1rem' }}
      >
        {saving ? <span className="spinner" /> : 'Continue →'}
      </button>
    </div>
  )
}
