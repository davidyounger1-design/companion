import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { roleHome } from '../lib/roleHome'
import { fetchCatalog, type CatalogPlan } from '../lib/catalog'
import { isFamilyPlan, checkPlan } from '../lib/planCheck'
import { supabase } from '../lib/supabase'

const CHECKOUT_URL = 'https://myappbuddy.com.au/api/v1/checkout'

const PLAN_LABEL: Record<string, string> = {
  family: 'Family (free)',
  solo: 'Solo',
  starter: 'Starter',
  team: 'Team',
  enterprise: 'Enterprise',
}
// MyAppBuddy status strings → the billing_status keys this screen renders.
const MAB_STATUS: Record<string, string> = {
  active: 'active', trialing: 'trial', trial: 'trial',
  past_due: 'past_due', paused: 'past_due', canceled: 'cancelled', cancelled: 'cancelled',
}
const BILLING_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  trial:    { label: 'Free trial',       color: 'var(--color-primary-deep)', bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)' },
  active:   { label: 'Active',           color: 'var(--color-primary-deep)', bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)' },
  past_due: { label: 'Payment overdue',  color: 'var(--color-error)',        bg: 'color-mix(in srgb, var(--color-error) 15%, transparent)' },
  cancelled:{ label: 'Cancelled',        color: 'var(--color-muted)',        bg: 'color-mix(in srgb, var(--color-muted) 15%, transparent)' },
}

function fmtPrice(cents: number, perSeat: boolean, interval: 'month' | 'year'): string {
  if (cents === 0) return 'Free'
  const perMonth = interval === 'year' ? cents / 12 : cents
  const dollars = perMonth / 100
  const d = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2)
  return `A$${d}${perSeat ? '/mo·seat' : '/mo'}`
}

export default function Account() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, org, profile, refreshProfile } = useAuth()
  const [plans, setPlans] = useState<CatalogPlan[]>([])
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  // The LIVE subscription as MyAppBuddy sees it — the source of truth for what
  // to display. org.plan/org.billing_status are only a local mirror that can go
  // stale (a family signup hardcodes them once), so they're the fallback only.
  const [live, setLive] = useState<{ plan: string | null; status: string | null } | null>(null)

  // Single display source: the shared hub catalog drives both the plan name
  // shown above and the switchable plan list below — no MAB admin site embed.
  useEffect(() => {
    fetchCatalog().then(setPlans)
  }, [])

  // Ask MyAppBuddy for the real current plan/status on load. If it fails we
  // simply fall back to the local org values below.
  useEffect(() => {
    checkPlan().then((info) => {
      if (info.plan || info.status) setLive({ plan: info.plan, status: info.status })
    })
  }, [])

  // Only the coordinator (account owner) may view/change the subscription.
  if (profile && profile.role !== 'coordinator') {
    return <Navigate to={roleHome(profile.role, org?.org_type)} replace />
  }

  // Resolve the display name for whatever MAB reports live: if it's a plan id
  // (e.g. companion_family_029) map it through the catalog; if it's already a
  // display name (our /link resolver returns planName), use it as-is.
  const livePlanName = live?.plan
    ? (plans.find((p) => p.id === live.plan)?.name ?? live.plan)
    : null
  const localName = plans.find((p) => p.id === org?.plan)?.name
  const planLabel =
    livePlanName ?? localName ?? PLAN_LABEL[org?.plan ?? ''] ?? (org?.plan ?? 'Unknown')

  // Live status wins; fall back to the local mirror only if MAB didn't answer.
  const statusKey = (live?.status ? MAB_STATUS[live.status] : null) ?? org?.billing_status ?? ''
  const billing = BILLING_LABEL[statusKey]

  // Every plan is switchable — just not the one you're already on. (Catalog
  // already drops archived/hidden tiers like Enterprise.) Switching also flips
  // org_type below so the experience follows the plan.
  const switchable = plans.filter((p) => {
    if (p.id === org?.plan) return false
    if (livePlanName && p.name === livePlanName) return false
    return true
  })
  const hasAnnual = switchable.some((p) => p.priceYear && p.priceYear > 0)

  async function choose(plan: CatalogPlan) {
    if (!org?.id || !user?.email) return
    setBusyId(plan.id)
    setError('')
    try {
      const useAnnual = interval === 'year' && !!plan.priceYear && plan.priceYear > 0
      const res = await fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          name: profile?.full_name ?? '',
          plan_id: plan.id,
          interval: useAnnual ? 'year' : 'month',
          trial: false,
          currency: 'AUD',
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json?.message ?? json?.error ?? 'Could not change plan — please try again.')
        return
      }
      // Paid plans return a hosted checkout/payment page — send them there.
      const url: string | undefined = json?.checkout_url ?? json?.url ?? json?.payment_url
      if (url) { window.location.href = url; return }

      // Free/trial-less change resolved server-side — mirror it onto the org.
      const subId: string | undefined = json?.subscription?.id
      const accountId: string | undefined = json?.account?.id
      const status: string | undefined = json?.subscription?.status
      await supabase
        .from('organisations')
        .update({
          plan: plan.id,
          // Experience follows the plan: a family-tier plan runs the family
          // portal, anything else the provider portal.
          org_type: isFamilyPlan(plan.id) ? 'family' : 'provider',
          billing_status: status === 'trialing' ? 'trial' : 'active',
          ...(subId && { myappbuddy_subscription_id: subId }),
          ...(accountId && { myappbuddy_account_id: accountId }),
        })
        .eq('id', org.id)
      qc.invalidateQueries({ queryKey: ['mab-features'] })
      refreshProfile?.()
      setDone(true)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{
        padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)', flexShrink: 0,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Subscription</h1>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem 1rem 0' }}>
        {/* Current plan summary */}
        <div className="card card-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>Current plan</p>
            <p style={{ margin: '0.2rem 0 0', fontWeight: 700, fontSize: '1rem' }}>{planLabel}</p>
          </div>
          {billing && (
            <span style={{
              fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.7rem', borderRadius: 99,
              background: billing.bg, color: billing.color,
            }}>{billing.label}</span>
          )}
        </div>

        {/* Change plan */}
        <p className="eyebrow" style={{ margin: '1.25rem 0 0.5rem' }}>Change plan</p>

        {done && (
          <div className="alert" style={{ marginBottom: '0.75rem', background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary-deep)' }}>
            Plan updated. It may take a moment to apply everywhere.
          </div>
        )}
        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

        {hasAnnual && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            {(['month', 'year'] as const).map((iv) => (
              <button key={iv} type="button" onClick={() => setInterval(iv)}
                style={{
                  padding: '0.35rem 0.9rem', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
                  fontWeight: interval === iv ? 600 : 400, cursor: 'pointer',
                  border: `1.5px solid ${interval === iv ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: interval === iv ? 'color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))' : 'var(--color-surface)',
                }}>
                {iv === 'month' ? 'Monthly' : 'Annual'}
              </button>
            ))}
          </div>
        )}

        {plans.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-muted)' }}><span className="spinner" /></div>
        )}
        {plans.length > 0 && switchable.length === 0 && (
          <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>You're on the only plan available for this account type.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
          {switchable.map((plan) => {
            const useAnnual = interval === 'year' && !!plan.priceYear && plan.priceYear > 0
            const cents = useAnnual ? plan.priceYear! : (plan.priceMonth ?? 0)
            return (
              <div key={plan.id} className="card card-sm"
                style={{ border: plan.popular ? '2px solid var(--color-primary)' : '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem' }}>
                    {plan.name}
                    {plan.popular && <span className="badge badge-sage" style={{ marginLeft: '0.5rem', fontSize: '0.7rem', verticalAlign: 'middle' }}>Popular</span>}
                  </span>
                  <span style={{ fontWeight: 600 }}>{fmtPrice(cents, plan.perSeat, useAnnual ? 'year' : 'month')}</span>
                </div>
                {plan.blurb && <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '0.35rem 0 0.5rem' }}>{plan.blurb}</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
                  {plan.features.map((f) => (
                    <span key={f} style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>✓ {f}</span>
                  ))}
                </div>
                <button className="btn btn-primary btn-full" disabled={busyId !== null}
                  onClick={() => choose(plan)} style={{ fontSize: '0.9rem' }}>
                  {busyId === plan.id ? <span className="spinner" /> : `Switch to ${plan.name}`}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Billing portal link */}
      <div style={{ padding: '0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom))', flexShrink: 0, textAlign: 'center', borderTop: '1px solid var(--color-border)' }}>
        <a href="https://myappbuddy.com.au/?admin" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '0.8rem', color: 'var(--color-muted)', textDecoration: 'none' }}>
          Invoices &amp; payment methods →
        </a>
      </div>
    </div>
  )
}
