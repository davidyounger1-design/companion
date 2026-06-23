import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const CATALOG_URL = 'https://myappbuddy.com.au/api/v1/catalog'
const APP_ID = 'companion'

interface CatalogPlan {
  id: string
  appId: string
  name: string
  blurb: string
  priceMonth: number | null
  perSeat: boolean
  popular: boolean
  features: string[]
  sort?: number
  archived?: boolean
  hidden?: boolean
}

interface Plan {
  id: string
  name: string
  price: string
  suffix: string
  sub: string
  features: string[]
  featured: boolean
}

function catalogToDisplay(p: CatalogPlan): Plan {
  const dollars = p.priceMonth != null ? p.priceMonth / 100 : null
  const price = dollars === null ? 'Custom' : dollars === 0 ? 'Free' : `A$${dollars}`
  const suffix = p.priceMonth && p.perSeat ? '/client/mo' : p.priceMonth && !p.perSeat ? '/mo' : ''
  return { id: p.id, name: p.name, price, suffix, sub: p.blurb, features: p.features, featured: p.popular }
}

export default function Step2Plan() {
  const navigate = useNavigate()
  const { profile, user } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [selected, setSelected] = useState('companion_starter')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [orgId, setOrgId] = useState<string | null>(profile?.org_id ?? null)

  useEffect(() => {
    fetch(CATALOG_URL)
      .then(r => r.json())
      .then((data: { plans: CatalogPlan[] }) => {
        const appPlans = (data.plans ?? [])
          .filter(p => p.appId === APP_ID && !p.archived && !p.hidden)
          .filter(p => p.id !== 'companion_family' && p.id !== 'companion_enterprise')
          .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          .map(catalogToDisplay)
        setPlans(appPlans)
      })
      .catch(() => {
        setPlans([
          { id: 'companion_solo',     name: 'Solo',    price: 'A$29', suffix: '/mo', sub: 'Up to 3 participants',  features: ['3 active participants', 'Unlimited workers & family', 'Daily digest', 'Behaviour notes'], featured: false },
          { id: 'companion_starter',  name: 'Starter', price: 'A$49', suffix: '/mo', sub: 'Up to 10 participants', features: ['10 active participants', 'Unlimited workers & family', 'Daily digest', 'Behaviour notes', 'Provider dashboard'], featured: true },
          { id: 'companion_team',     name: 'Team',    price: 'A$7',  suffix: '/client/mo', sub: 'per month, no cap', features: ['Unlimited participants', 'NDIS exports', 'Incident workflows', 'Priority support'], featured: false },
        ])
      })
  }, [])

  useEffect(() => {
    if (orgId) return
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

      {plans.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-muted)' }}>
          <span className="spinner" />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {plans.map((plan) => (
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
                {plan.featured && <span className="badge badge-sage" style={{ marginLeft: '0.5rem', verticalAlign: 'middle', fontSize: '0.7rem' }}>Popular</span>}
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600 }}>{plan.price}{plan.suffix}</span>
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
        disabled={saving || plans.length === 0}
        style={{ fontSize: '1rem' }}
      >
        {saving ? <span className="spinner" /> : 'Start free trial →'}
      </button>
    </div>
  )
}
