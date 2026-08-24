import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { roleHome } from '../lib/roleHome'
import { checkPlan } from '../lib/planCheck'
import { supabase } from '../lib/supabase'
import { MabEmbed } from '../components/MabEmbed'
import { WidgetBoundary } from '../components/WidgetBoundary'
import { useFeatures } from '../hooks/useFeatures'
import { useOrgFeatureFlags } from '../hooks/useOrgFeatureFlags'
import { FEATURES } from '../lib/features'
import type { BillingStatus } from '../types/database'

// MyAppBuddy has no "current subscription" embed — its pricing-table deliberately
// EXCLUDES the current plan (shows only switch-to options), and license-manager
// is a seat allocator, not a plan summary. So the current-plan line here is
// native (from checkPlan), the plan CHANGE grid is MAB's <myappbuddy-pricing-table>,
// and cancel/invoices go through MAB's billing portal (Manage subscription).
//
// Reconciling org.plan/org_type with the live subscription happens once per
// session in AuthContext (reconcileOrgPlan) — not here, to avoid two places
// writing to organisations. This screen only reads checkPlan() for display.
const MAB_STATUS: Record<string, BillingStatus> = {
  active: 'active', trialing: 'trial', trial: 'trial',
  past_due: 'past_due', paused: 'past_due', canceled: 'cancelled', cancelled: 'cancelled',
}
const BILLING_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  trial:    { label: 'Free trial',      color: 'var(--color-primary-deep)', bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)' },
  active:   { label: 'Active',          color: 'var(--color-primary-deep)', bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)' },
  past_due: { label: 'Payment overdue', color: 'var(--color-error)',        bg: 'color-mix(in srgb, var(--color-error) 15%, transparent)' },
  cancelled:{ label: 'Cancelled',       color: 'var(--color-muted)',        bg: 'color-mix(in srgb, var(--color-muted) 15%, transparent)' },
}

export default function Account() {
  const navigate = useNavigate()
  const { org, profile } = useAuth()
  const [pk, setPk] = useState<string | null>(null)
  const [live, setLive] = useState<{ plan: string | null; planId: string | null; status: string | null }>({ plan: null, planId: null, status: null })
  const [planReady, setPlanReady] = useState(false)
  const [portalBusy, setPortalBusy] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(() => !!customElements.get('myappbuddy-pricing-table'))
  // "Seats" for Companion = active members in the org (a headcount from our own
  // profiles table — MAB has no seat licensing for Companion). Not a "used of N"
  // cap; there is no seat limit.
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const { has } = useFeatures()
  const { isEnabled, setFlag } = useOrgFeatureFlags()
  const [savingFlag, setSavingFlag] = useState(false)
  const showMedicationToggle = has(FEATURES.medicationTracking)
  const medicationTrackingEnabled = isEnabled('medication_tracking')
  const [webhookBusy, setWebhookBusy] = useState(false)
  const [webhookResult, setWebhookResult] = useState<unknown>(null)
  const [webhookError, setWebhookError] = useState('')

  async function toggleMedicationTracking(on: boolean) {
    setSavingFlag(true)
    try {
      await setFlag.mutateAsync({ key: 'medication_tracking', value: on })
    } catch { /* ignore — setFlag handles error display */ }
    setSavingFlag(false)
  }

  // One-time setup action — registers this project's sync-subscription
  // function as a MAB webhook endpoint (idempotent, safe to call again).
  // Shows the raw response (including the one-time secret) so it can be
  // copied straight into `supabase secrets set` / the Dashboard — nobody
  // else ever sees this value.
  async function registerWebhook() {
    setWebhookBusy(true)
    setWebhookError('')
    setWebhookResult(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('register-mab-webhook')
      if (fnErr) { setWebhookError('Could not reach the function. Try again.'); return }
      setWebhookResult(data)
    } catch {
      setWebhookError('Could not reach the function. Try again.')
    } finally {
      setWebhookBusy(false)
    }
  }

  useEffect(() => {
    supabase.functions.invoke('mab-embed-key')
      .then(({ data }) => { if (data?.publishableKey) setPk(data.publishableKey) })
      .catch(() => {})
    checkPlan()
      .then((info) => {
        setLive({ plan: info.plan, planId: info.plan_id ?? info.plan, status: info.status })
        setPlanReady(true)
      })
      .catch(() => setPlanReady(true))
    // Member headcount for this org (active profiles). RPC first (RLS-safe),
    // profiles count as fallback — same pattern as the Members page.
    ;(async () => {
      const rpc = await supabase.rpc('get_org_members')
      if (!rpc.error && Array.isArray(rpc.data)) { setMemberCount(rpc.data.length); return }
      if (org?.id) {
        const { count } = await supabase
          .from('profiles').select('id', { count: 'exact', head: true }).eq('org_id', org.id)
        if (typeof count === 'number') setMemberCount(count)
      }
    })().catch(() => {})
  }, [org?.id])

  useEffect(() => {
    if (ready) return
    let alive = true
    customElements.whenDefined('myappbuddy-pricing-table').then(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [ready])

  // Only the coordinator (account owner) may view/change the subscription.
  if (profile && profile.role !== 'coordinator') {
    return <Navigate to={roleHome(profile.role, org?.org_type)} replace />
  }

  const planLabel = live.plan ?? org?.plan ?? 'Unknown'
  const statusKey = (live.status ? MAB_STATUS[live.status] : null) ?? org?.billing_status ?? ''
  const billing = BILLING_LABEL[statusKey]

  async function openPortal() {
    setPortalBusy(true)
    setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('companion-billing-portal')
      const url: string | undefined = data?.url
      if (fnErr || !url) {
        setError(
          data?.error === 'no-subscription'
            ? "We couldn't find an active subscription for your account. Contact support if this persists."
            : 'Could not open the billing portal just now. Please try again.'
        )
        return
      }
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      setError('Could not open the billing portal just now. Please try again.')
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

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem 1rem calc(1rem + env(safe-area-inset-bottom))' }}>
        {/* Current plan (native — MAB has no current-plan embed) */}
        <div className="card card-sm" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <p className="eyebrow" style={{ margin: 0 }}>Current plan</p>
            <p style={{ margin: '0.2rem 0 0', fontWeight: 700, fontSize: '1rem' }}>
              {!planReady ? (
                <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>Loading…</span>
              ) : (
                <>
                  {planLabel}
                  {memberCount != null && (
                    <span style={{ fontWeight: 400, fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                      {' · '}{memberCount} member{memberCount === 1 ? '' : 's'}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          {billing && (
            <span style={{
              fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.7rem', borderRadius: 99,
              background: billing.bg, color: billing.color,
            }}>{billing.label}</span>
          )}
        </div>

        {/* Manage subscription — MAB billing portal (cancel, invoices, payment) */}
        <button className="btn btn-primary btn-full" onClick={openPortal} disabled={portalBusy}
          style={{ marginTop: '0.75rem', fontSize: '0.95rem' }}>
          {portalBusy ? <span className="spinner" /> : 'Manage subscription'}
        </button>
        <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: '0.4rem 0 0', textAlign: 'center' }}>
          Cancel, update payment, or view invoices in your secure billing portal.
        </p>
        {error && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{error}</div>}

        {/* Change plan — MAB's pricing-table (shows the plans you can switch to) */}
        <p className="eyebrow" style={{ margin: '1.5rem 0 0.5rem' }}>Change plan</p>
        {!pk || !ready ? (
          <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-muted)' }}><span className="spinner" /></div>
        ) : (
          <WidgetBoundary fallback={<p style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>Plans are unavailable right now.</p>}>
            <MabEmbed tag="myappbuddy-pricing-table" attrs={{
              app: 'companion',
              'publishable-key': pk,
              currency: 'AUD',
              ...(live.planId ? { 'current-plan': live.planId } : {}),
            }} />
          </WidgetBoundary>
        )}

        {/* Org-level feature toggles */}
        {showMedicationToggle && (
          <div className="card card-sm" style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>💊 Medication tracking</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: '0.2rem 0 0' }}>
                  Track medications and log administrations for all participants.
                </p>
              </div>
              <button
                onClick={() => toggleMedicationTracking(!medicationTrackingEnabled)}
                disabled={savingFlag}
                style={{
                  flexShrink: 0, width: 44, height: 24, borderRadius: 12, border: 'none',
                  cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                  background: medicationTrackingEnabled ? 'var(--color-primary)' : 'var(--color-border)',
                }}
                aria-label={`${medicationTrackingEnabled ? 'Disable' : 'Enable'} medication tracking`}
              >
                <span style={{
                  position: 'absolute', top: 2, left: medicationTrackingEnabled ? 22 : 2,
                  width: 20, height: 20, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  display: 'block',
                }} />
              </button>
            </div>
          </div>
        )}

        {/* One-time setup: register the MAB webhook endpoint. Idempotent —
            safe to click again after a redeploy. Remove this block once
            confirmed registered and activated in MAB Admin. */}
        <div className="card card-sm" style={{ marginTop: '1.5rem' }}>
          <p style={{ fontWeight: 600, fontSize: '0.9rem', margin: 0 }}>⚙️ Register MAB webhook (one-time setup)</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: '0.2rem 0 0.75rem' }}>
            Registers this project's subscription-sync function with MyAppBuddy so cancellations sync
            immediately instead of only at next sign-in. Click once, then follow the steps shown below.
          </p>
          <button className="btn btn-secondary" onClick={registerWebhook} disabled={webhookBusy}>
            {webhookBusy ? <span className="spinner" /> : 'Register webhook'}
          </button>
          {webhookError && <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>{webhookError}</div>}
          {webhookResult != null && (
            <pre style={{
              marginTop: '0.75rem', padding: '0.75rem', borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg)', border: '1px solid var(--color-border)',
              fontSize: '0.75rem', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>{JSON.stringify(webhookResult, null, 2)}</pre>
          )}
        </div>
      </div>
    </div>
  )
}
