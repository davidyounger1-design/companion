import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { roleHome } from '../lib/roleHome'
import { fetchCatalog } from '../lib/catalog'
import { checkPlan } from '../lib/planCheck'
import { supabase } from '../lib/supabase'

const PLAN_LABEL: Record<string, string> = {
  family: 'Family (free)',
  solo: 'Solo',
  starter: 'Starter',
  team: 'Team',
  enterprise: 'Enterprise',
}
const BILLING_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  trial:    { label: 'Free trial',       color: 'var(--color-primary-deep)', bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)' },
  active:   { label: 'Active',           color: 'var(--color-primary-deep)', bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)' },
  past_due: { label: 'Payment overdue',  color: 'var(--color-error)',        bg: 'color-mix(in srgb, var(--color-error) 15%, transparent)' },
  cancelled:{ label: 'Cancelled',        color: 'var(--color-muted)',        bg: 'color-mix(in srgb, var(--color-muted) 15%, transparent)' },
}

export default function Account() {
  const navigate = useNavigate()
  const { user, org, profile } = useAuth()
  const [catalogName, setCatalogName] = useState<string | null>(null)

  // Resolve the real plan name from the hub catalog by the org's plan id
  // (e.g. companion_family_029 → "Family +"), so upgrades show correctly
  // instead of the local 'family' sentinel.
  useEffect(() => {
    if (!org?.plan) return
    fetchCatalog().then((plans) => {
      const match = plans.find((p) => p.id === org.plan)
      if (match) setCatalogName(match.name)
    })
  }, [org?.plan])

  // Only the coordinator (account owner) may view/change the subscription.
  // Other roles reaching /account directly are sent back to their home.
  if (profile && profile.role !== 'coordinator') {
    return <Navigate to={roleHome(profile.role, org?.org_type)} replace />
  }

  const billing = BILLING_LABEL[org?.billing_status ?? '']
  const planLabel = catalogName ?? PLAN_LABEL[org?.plan ?? ''] ?? (org?.plan ?? 'Unknown')
  const pricingSrc = `https://myappbuddy.com.au/?embed=1&tab=pricing&app=companion`
    + (user?.email ? `&email=${encodeURIComponent(user.email)}` : '')
    + (profile?.full_name ? `&name=${encodeURIComponent(profile.full_name)}` : '')

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

      {/* Current plan summary */}
      <div style={{ padding: '1rem 1rem 0', flexShrink: 0 }}>
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
      </div>

      {/* Pricing iframe */}
      <div style={{ flex: 1, minHeight: 0, padding: '0.75rem 1rem 0' }}>
        <p className="eyebrow" style={{ margin: '0 0 0.5rem' }}>Change plan</p>
        <iframe
          src={pricingSrc}
          style={{ border: 'none', width: '100%', height: 'calc(100% - 1.5rem)', display: 'block', borderRadius: 8 }}
          title="Manage your Companion plan"
        />
      </div>

      {/* Billing portal link */}
      <div style={{ padding: '0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom))', flexShrink: 0, textAlign: 'center' }}>
        <a href="https://myappbuddy.com.au/?admin" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '0.8rem', color: 'var(--color-muted)', textDecoration: 'none' }}>
          Invoices &amp; payment methods →
        </a>
        <Diagnostics org={org} />
      </div>
    </div>
  )
}

// TEMPORARY: coordinator-only readout of exactly what the plan/entitlement
// resolution chain returns, so a subscription/mood mismatch can be traced to
// the precise step (org row → check-plan by email → check-features). Safe to
// remove once the MAB-side resolution is confirmed working.
function Diagnostics({ org }: { org: { plan?: string | null; billing_status?: string | null; myappbuddy_subscription_id?: string | null } | null }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [out, setOut] = useState<Record<string, unknown> | null>(null)

  const run = async () => {
    setLoading(true)
    const result: Record<string, unknown> = {
      org: {
        plan: org?.plan ?? null,
        billing_status: org?.billing_status ?? null,
        myappbuddy_subscription_id: org?.myappbuddy_subscription_id ?? null,
      },
    }
    try {
      result.checkPlan = await checkPlan()
    } catch (e) {
      result.checkPlan = { error: String(e) }
    }
    try {
      const { data, error } = await supabase.functions.invoke('check-features')
      result.checkFeatures = error ? { error: error.message } : data
    } catch (e) {
      result.checkFeatures = { error: String(e) }
    }
    setOut(result)
    setLoading(false)
  }

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <button
        onClick={() => { setOpen((o) => !o); if (!out) void run() }}
        className="btn btn-ghost"
        style={{ fontSize: '0.7rem', color: 'var(--color-muted)', padding: '0.2rem 0.5rem' }}>
        {open ? 'Hide' : 'Show'} diagnostics
      </button>
      {open && (
        <div style={{ marginTop: '0.5rem', textAlign: 'left' }}>
          <button onClick={() => void run()} className="btn btn-ghost"
            style={{ fontSize: '0.7rem', marginBottom: '0.4rem' }}>
            {loading ? 'Checking…' : 'Refresh'}
          </button>
          <pre style={{
            fontSize: '0.65rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            background: 'var(--color-surface, #f5f5f5)', color: 'var(--color-text)',
            padding: '0.6rem', borderRadius: 6, margin: 0, maxHeight: '40vh', overflow: 'auto',
          }}>
            {out ? JSON.stringify(out, null, 2) : 'No data yet.'}
          </pre>
        </div>
      )}
    </div>
  )
}
