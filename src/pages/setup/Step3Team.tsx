import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

interface SentInvite {
  email: string
  token: string
}

export default function Step3Team() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'support_worker' | 'coordinator'>('support_worker')
  const [sent, setSent] = useState<SentInvite[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  const [orgId, setOrgId] = useState<string | null>(profile?.org_id ?? null)

  useEffect(() => {
    if (orgId) return
    supabase
      .from('profiles')
      .select('id, org_id')
      .eq('id', user?.id ?? '')
      .single()
      .then(({ data }) => {
        if (data?.org_id) setOrgId(data.org_id)
      })
  }, [user?.id])

  async function sendInvite() {
    if (!email.trim() || !orgId) {
      setError('Organisation not ready — please wait a moment and try again.')
      return
    }
    setSending(true)
    setError('')
    const { data, error: err } = await supabase
      .from('invites')
      .insert({ org_id: orgId, email: email.trim().toLowerCase(), role, status: 'pending' })
      .select('token')
      .single()
    setSending(false)
    if (err || !data) {
      setError(err?.message ?? 'Could not create invite.')
    } else {
      setSent((prev) => [...prev, { email: email.trim(), token: data.token }])
      setEmail('')
    }
  }

  function inviteLink(token: string) {
    return `${window.location.origin}/accept-invite?token=${token}`
  }

  async function copyLink(token: string) {
    await navigator.clipboard.writeText(inviteLink(token))
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>Invite your team</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '2rem' }}>
        Create an invite link and send it to your team member however you like.
      </p>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="inviteEmail">Their email address</label>
          <input
            id="inviteEmail"
            type="email"
            className="input"
            placeholder="worker@yourorg.com.au"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
          />
        </div>
        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="inviteRole">Role</label>
          <select
            id="inviteRole"
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            <option value="support_worker">Support Worker</option>
            <option value="coordinator">Coordinator</option>
          </select>
        </div>
        <button
          className="btn btn-primary"
          onClick={sendInvite}
          disabled={sending || !email.trim()}
        >
          {sending ? <span className="spinner" /> : 'Generate invite link'}
        </button>
      </div>

      {sent.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <p className="eyebrow" style={{ marginBottom: '0.75rem' }}>Invite links — share these directly</p>
          {sent.map((inv) => (
            <div key={inv.token} className="card" style={{ marginBottom: '0.5rem', padding: '0.75rem 1rem' }}>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.4rem' }}>{inv.email}</p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input
                  readOnly
                  value={inviteLink(inv.token)}
                  className="input"
                  style={{ fontSize: '0.75rem', flex: 1 }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  className="btn btn-ghost"
                  onClick={() => copyLink(inv.token)}
                  style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}
                >
                  {copied === inv.token ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button className="btn btn-ghost btn-full" onClick={() => navigate('/setup/clients')}>
          Skip for now
        </button>
        <button
          className="btn btn-primary btn-full"
          onClick={() => navigate('/setup/clients')}
          disabled={sent.length === 0}
        >
          Continue →
        </button>
      </div>
    </div>
  )
}
