import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabase'

export default function FamilyStep2Invite() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState<string[]>([])
  const [error, setError] = useState('')
  const [fallbackLinks, setFallbackLinks] = useState<{ email: string; url: string }[]>([])

  // Use distinct key from FamilyDashboard (which selects full_name+dob) to avoid cache collision
  const { data: clientId, isLoading: clientLoading } = useQuery({
    queryKey: ['family-client-id', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_family')
        .select('client_id')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return data?.client_id ?? null
    },
    enabled: !!user,
  })

  async function sendInvite() {
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !profile?.org_id || !clientId) return
    setSending(true)
    setError('')
    const { data, error: fnErr } = await supabase.functions.invoke('invite-member', {
      body: { email: trimmed, role: 'family', org_id: profile.org_id, client_id: clientId },
    })
    setSending(false)
    if (fnErr || !data?.ok) {
      if (data?.inviteUrl) {
        // Email failed but invite was created — show link for manual sharing
        setFallbackLinks((prev) => [...prev, { email: trimmed, url: data.inviteUrl }])
        setEmail('')
      } else {
        setError(data?.error ?? fnErr?.message ?? 'Could not send invite.')
      }
      return
    }
    setSent((prev) => [...prev, trimmed])
    setEmail('')
  }

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Step 2 of 3</p>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        Invite family members
      </h1>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
        Anyone you invite can add journal entries. You can also do this later.
      </p>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>
      )}

      {fallbackLinks.map(({ email: e, url }) => (
        <div key={e} style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 10,
          padding: '0.75rem 1rem',
          marginBottom: '0.75rem',
          fontSize: '0.875rem',
        }}>
          <p style={{ margin: '0 0 0.4rem', fontWeight: 500 }}>
            Invite created for {e} — email couldn't send. Share this link:
          </p>
          <p style={{ margin: '0 0 0.5rem', wordBreak: 'break-all', color: 'var(--color-muted)', fontSize: '0.8rem' }}>{url}</p>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '0.8rem', padding: '0.25rem 0.75rem' }}
            onClick={() => navigator.clipboard.writeText(url).catch(() => {})}
          >
            Copy link
          </button>
        </div>
      ))}

      {sent.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          {sent.map((e) => (
            <div key={e} className="alert" style={{
              background: 'var(--color-success-bg, #f0fdf4)',
              color: 'var(--color-success, #166534)',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
            }}>
              Invite sent to {e}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <input
          className="input"
          type="email"
          placeholder="their@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
          style={{ flex: 1 }}
        />
        <button
          className="btn btn-secondary"
          onClick={sendInvite}
          disabled={!email.trim() || sending || clientLoading || !clientId}
        >
          {sending ? <span className="spinner" /> : 'Send'}
        </button>
      </div>

      <button
        className="btn btn-primary btn-full"
        onClick={() => navigate('/setup/family/done')}
        style={{ fontSize: '1rem' }}
      >
        {sent.length > 0 ? 'Continue →' : 'Skip for now →'}
      </button>
    </div>
  )
}
