import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { roleHome } from '../lib/roleHome'
import { fetchCatalog, type CatalogPlan } from '../lib/catalog'
import { checkPlan } from '../lib/planCheck'
import { supabase } from '../lib/supabase'

// Plan-label fallback, keyed on the UNPREFIXED plan id. org.plan can hold either
// the unprefixed sentinel ('family', set by setup_family_org) or the hub's real
// prefixed id ('companion_family' etc., from checkout/sync) — so always strip a
// leading `companion_` before looking up here.
const PLAN_LABEL: Record<string, string> = {
  family: 'Family (free)',
  family_029: 'Family +',
  solo: 'Solo',
  starter: 'Starter',
  team: 'Team',
  enterprise: 'Enterprise',
}
const normalizePlan = (plan: string | null | undefined) => (plan ?? '').replace(/^companion_/, '')

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
  const { org, profile } = useAuth()
  const [plans, setPlans] = useState<CatalogPlan[]>([])
  const [interval, setInterval] = useState<'month' | 'year'>('month')
  const [portalBusy, setPortalBusy] = useState(false)
  const [error, setError] = useState('')
  // The LIVE subscription as MyAppBuddy sees it — the source of truth for the
  // current-plan display. org.plan/org.billing_status are a local mirror that
  // can go stale (a family signup hardcodes them once), so they're the fallback.
  const [live, setLive] = useState<{ plan: string | null; plan_id: string | null; status: string | null } | null>(null)

  useEffect(() => { fetchCatalog().then(setPlans) }, [])

  useEffect(() => {
    checkPlan().then((info) => {
      if (info.plan || info.plan_id || info.status) {
        setLive({ plan: info.plan, plan_id: info.plan_id, status: info.status })
      }
    })
  }, [])

  // Only the coordinator (account owner) may view/change the subscription.
  if (profile && profile.role !== 'coordinator') {
    return <Navigate to={roleHome(profile.role, org?.org_type)} replace />
  }

  // Current plan id (authoritative live id, else the local mirror) + its name.
  const currentPlanId = live?.plan_id ?? org?.plan ?? null
  const liveName = live?.plan
    ? (plans.find((p) => p.id === live.plan_id)?.name ?? live.plan)
    : null
  const localName = plans.find((p) => p.id === org?.plan)?.name
  const planLabel =
    liveName ?? localName ?? PLAN_LABEL[normalizePlan(org?.plan)] ?? (org?.plan ?? 'Unknown')

  const statusKey = (live?.status ? MAB_STATUS[live.status] : null) ?? org?.billing_status ?? ''
  const billing = BILLING_LABEL[statusKey]

  const isCurrent = (p: CatalogPlan) =>
    p.id === currentPlanId || normalizePlan(p.id) === normalizePlan(currentPlanId)
  const hasAnnual = plans.some((p) => p.priceYear && p.priceYear > 0)

  // Open the real MyAppBuddy billing portal (upgrade/downgrade/cancel/invoices)
  // via a one-time magic-login URL — MAB owns all the billing logic.
  async function openPortal() {
    setPortalBusy(true)
    setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('companion-billing-portal')
      const url: string | undefined = data?.url
      if (fnErr || !url) {
        setError('Could not open the billing portal just now. Please try again in a moment.')
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setError('Could not open the billing portal just now. Please try again in a moment.')
    } finally {
      setPortalBusy(false)
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

        {/* Manage subscription — the real MAB billing portal handles all changes */}
        <button className="btn btn-primary btn-full" onClick={openPortal} disabled={portalBusy}
          style={{ marginTop: '0.75rem', fontSize: '0.95rem' }}>
          {portalBusy ? <span className="spinner" /> : 'Manage subscription'}
        </button>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.4rem 0 0', textAlign: 'center' }}>
          Change plan, update payment, or view invoices in your secure billing portal.
        </p>
        {error && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{error}</div>}

        {/* Available plans (informational) */}
        <p className="eyebrow" style={{ margin: '1.5rem 0 0.5rem' }}>Available plans</p>

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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
          {plans.map((plan) => {
            const useAnnual = interval === 'year' && !!plan.priceYear && plan.priceYear > 0
            const cents = useAnnual ? plan.priceYear! : (plan.priceMonth ?? 0)
            const current = isCurrent(plan)
            return (
              <div key={plan.id} className="card card-sm"
                style={{
                  border: current
                    ? '2px solid var(--color-primary)'
                    : plan.popular ? '2px solid color-mix(in srgb, var(--color-primary) 40%, transparent)' : '1px solid var(--color-border)',
                  background: current ? 'color-mix(in srgb, var(--color-primary) 6%, var(--color-surface))' : 'var(--color-surface)',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 700, fontSize: '1rem' }}>
                    {plan.name}
                    {current && <span className="badge badge-sage" style={{ marginLeft: '0.5rem', fontSize: '0.7rem', verticalAlign: 'middle' }}>Current</span>}
                    {!current && plan.popular && <span className="badge badge-sage" style={{ marginLeft: '0.5rem', fontSize: '0.7rem', verticalAlign: 'middle' }}>Popular</span>}
                  </span>
                  <span style={{ fontWeight: 600 }}>{fmtPrice(cents, plan.perSeat, useAnnual ? 'year' : 'month')}</span>
                </div>
                {plan.blurb && <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '0.35rem 0 0.5rem' }}>{plan.blurb}</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                  {plan.features.map((f) => (
                    <span key={f} style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>✓ {f}</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Invoices & payment methods — also reachable via Manage subscription */}
      <div style={{ padding: '0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom))', flexShrink: 0, textAlign: 'center', borderTop: '1px solid var(--color-border)' }}>
        <button onClick={openPortal} disabled={portalBusy} className="btn btn-ghost"
          style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
          Invoices &amp; payment methods →
        </button>
      </div>
    </div>
  )
}
