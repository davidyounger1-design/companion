import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const PLANS = [
  {
    id: 'solo',
    name: 'Solo',
    price: 'A$29/mo',
    sub: 'Up to 3 participants',
    features: ['3 active participants', 'Unlimited workers & family', 'Daily digest', 'Behaviour notes'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 'A$49/mo',
    sub: 'Up to 10 participants',
    highlight: true,
    features: ['10 active participants', 'Unlimited workers & family', 'Daily digest', 'Behaviour notes', 'Provider dashboard'],
  },
  {
    id: 'team',
    name: 'Team',
    price: 'A$7/participant',
    sub: 'per month, no cap',
    features: ['Unlimited participants', 'NDIS exports', 'Incident workflows', 'Priority support'],
  },
]

export default function Step2Plan() {
  const navigate = useNavigate()
  const { profile, user } = useAuth()
  const [selected, setSelected] = useState('starter')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Resolve org_id — may be stale right after Step 1 navigation.
  const [orgId, setOrgId] = useState<string | null>(profile?.org_id ?? null)

  useEffect(() => {
    if (orgId) return
    // Fetch directly from DB as authoritative source.
    supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user?.id ?? '')
      .single()
      .then(({ data }) => { if (data?.org_id) setOrgId(data.org_id) })
  }, [user?.id])

  async function handleContinue() {
    setSaving(true)
    setError('')
    try {
      if (orgId) {
        const { error: err } = await supabase
          .from('organisations')
          .update({ plan: selected })
          .eq('id', orgId)
        if (err) setError(err.message)
      }
      navigate('/setup/team')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>Choose your plan</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '2rem' }}>
        Your 14-day free trial starts today — no card required yet.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {PLANS.map((plan) => (
          <button
            key={plan.id}
            type="button"
            onClick={() => setSelected(plan.id)}
            style={{
              textAlign: 'left',
              padding: '1rem 1.25rem',
              borderRadius: 'var(--radius-md)',
              border: `2px solid ${selected === plan.id ? 'var(--color-primary)' : 'color-mix(in srgb, var(--color-muted) 25%, transparent)'}`,
              background: selected === plan.id ? 'color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))' : 'var(--color-surface)',
              cursor: 'pointer',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
              <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: '1rem' }}>
                {plan.name}
                {plan.highlight && <span className="badge badge-sage" style={{ marginLeft: '0.5rem', verticalAlign: 'middle', fontSize: '0.7rem' }}>Popular</span>}
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600 }}>{plan.price}</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>{plan.sub}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
              {plan.features.map((f) => (
                <span key={f} style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>✓ {f}</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      <button
        className="btn btn-primary btn-full"
        onClick={handleContinue}
        disabled={saving}
        style={{ fontSize: '1rem' }}
      >
        {saving ? <span className="spinner" /> : 'Start free trial →'}
      </button>
    </div>
  )
}
