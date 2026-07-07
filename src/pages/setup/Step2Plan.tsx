import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fetchCatalog } from '../../lib/catalog'

const CHECKOUT_URL = 'https://myappbuddy.com.au/api/v1/checkout'

interface Plan {
  id: string
  name: string
  priceMonthCents: number
  priceYearCents: number | null
  perSeat: boolean
  sub: string
  features: string[]
  featured: boolean
}

function fmtPrice(cents: number, perSeat: boolean, interval: 'month' | 'year'): { price: string; suffix: string } {
  const dollars = cents / 100
  if (interval === 'year') {
    const mo = (cents / 100 / 12).toFixed(2).replace(/\.00$/, '')
    return { price: `A$${mo}`, suffix: perSeat ? '/mo·seat' : '/mo' }
  }
  const d = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2)
  return { price: `A$${d}`, suffix: perSeat ? '/mo·seat' : '/mo' }
}

export default function Step2Plan() {
  const navigate = useNavigate()
  const { profile, user } = useAuth()
  const [plans, setPlans] = useState<Plan[]>([])
  const [selected, setSelected] = useState('companion_starter')
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [orgId, setOrgId] = useState<string | null>(profile?.org_id ?? null)

  useEffect(() => {
    // Single display source: the shared catalog (lib/catalog) owns the fetch
    // and fallback. The plan picker just drops the free & enterprise tiers.
    fetchCatalog().then(catalog => {
      const appPlans = catalog
        .filter(p => p.id !== 'companion_family' && p.id !== 'companion_enterprise')
        .map((p): Plan => ({
          id: p.id,
          name: p.name,
          priceMonthCents: p.priceMonth ?? 0,
          priceYearCents: p.priceYear && p.priceYear > 0 ? p.priceYear : null,
          perSeat: p.perSeat,
          sub: p.blurb,
          features: p.features,
          featured: p.popular,
        }))
      setPlans(appPlans)
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

  // Whether any plan has an annual option
  const hasAnnual = plans.some(p => p.priceYearCents != null)

  // Effective interval — fall back to month if selected plan has no annual price
  const selectedPlan = plans.find(p => p.id === selected)
  const effectiveInterval = (interval === 'year' && selectedPlan?.priceYearCents) ? 'year' : 'month'

  async function handleContinue() {
    setSaving(true)
    setError('')
    try {
      // 1. Register the trial subscription with MyAppBuddy
      const res = await fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user?.email ?? '',
          name: profile?.full_name ?? '',
          plan_id: selected,
          interval: effectiveInterval,
          trial: true,
          currency: 'AUD',
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.message ?? json?.error ?? 'Could not start trial — please try again.')
        return
      }

      const subId: string | undefined = json?.subscription?.id
      const accountId: string | undefined = json?.account?.id

      // 2. Save plan + subscription IDs to Supabase
      if (orgId) {
        await supabase
          .from('organisations')
          .update({
            plan: selected,
            ...(subId     && { myappbuddy_subscription_id: subId }),
            ...(accountId && { myappbuddy_account_id: accountId }),
            billing_status: 'trial',
          })
          .eq('id', orgId)
      }

      navigate('/setup/team')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>Choose your plan</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
        Your 14-day free trial starts today — no card required.
      </p>

      {/* Interval toggle */}
      {hasAnnual && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem' }}>
          {(['month', 'year'] as const).map(iv => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              style={{
                padding: '0.4rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem',
                fontWeight: interval === iv ? 600 : 400,
                border: `1.5px solid ${interval === iv ? 'var(--color-primary)' : 'color-mix(in srgb, var(--color-muted) 30%, transparent)'}`,
                background: interval === iv ? 'color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))' : 'var(--color-surface)',
                cursor: 'pointer',
              }}
            >
              {iv === 'month' ? 'Monthly' : 'Annual'}
              {iv === 'year' && <span style={{ marginLeft: '0.4rem', fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>Save up to 16%</span>}
            </button>
          ))}
        </div>
      )}

      {plans.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-muted)' }}>
          <span className="spinner" />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {plans.map((plan) => {
          const useAnnual = interval === 'year' && plan.priceYearCents != null
          const priceCents = useAnnual ? plan.priceYearCents! : plan.priceMonthCents
          const { price, suffix } = fmtPrice(priceCents, plan.perSeat, useAnnual ? 'year' : 'month')
          const annualTotal = useAnnual ? `Billed A$${(plan.priceYearCents! / 100).toFixed(0)}/yr` : null

          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelected(plan.id)}
              style={{
                textAlign: 'left', padding: '1rem 1.25rem',
                borderRadius: 'var(--radius-md)',
                border: `2px solid ${selected === plan.id ? 'var(--color-primary)' : 'color-mix(in srgb, var(--color-muted) 25%, transparent)'}`,
                background: selected === plan.id ? 'color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))' : 'var(--color-surface)',
                cursor: 'pointer', width: '100%',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
                <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: '1rem' }}>
                  {plan.name}
                  {plan.featured && <span className="badge badge-sage" style={{ marginLeft: '0.5rem', verticalAlign: 'middle', fontSize: '0.7rem' }}>Popular</span>}
                </span>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600 }}>
                  {price}<span style={{ fontSize: '0.8rem', fontWeight: 400 }}>{suffix}</span>
                </span>
              </div>
              {annualTotal && (
                <p style={{ fontSize: '0.75rem', color: 'var(--color-primary)', margin: '0 0 0.25rem', fontWeight: 500 }}>{annualTotal}</p>
              )}
              <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>{plan.sub}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {plan.features.map((f) => (
                  <span key={f} style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>✓ {f}</span>
                ))}
              </div>
            </button>
          )
        })}
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

      <p style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '1rem' }}>
        No credit card required. Cancel any time.
      </p>
    </div>
  )
}
