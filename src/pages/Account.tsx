import { useEffect, useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { roleHome } from '../lib/roleHome'
import { checkPlan } from '../lib/planCheck'
import { supabase } from '../lib/supabase'
import { MabEmbed } from '../components/MabEmbed'
import { WidgetBoundary } from '../components/WidgetBoundary'

// The Subscription screen is the two MyAppBuddy drop-in web components
// (from /embed/v1.js, loaded in index.html): the license-manager shows the
// current subscription and its manage/cancel actions; the pricing-table shows
// the available plans and drives changes. MAB owns all the billing logic, so
// there is no hand-built plan grid or PLAN_LABEL map here.
export default function Account() {
  const navigate = useNavigate()
  const { org, profile } = useAuth()
  const [pk, setPk] = useState<string | null>(null)
  const [sub, setSub] = useState<{ id: string | null; planId: string | null }>({ id: null, planId: null })
  const [resolved, setResolved] = useState(false)
  const [ready, setReady] = useState(
    () => !!customElements.get('myappbuddy-license-manager') && !!customElements.get('myappbuddy-pricing-table'),
  )

  // Server-derived publishable key (safe client-side) + resolve the caller's
  // real subscription id / plan id from MAB.
  useEffect(() => {
    supabase.functions.invoke('mab-embed-key')
      .then(({ data }) => { if (data?.publishableKey) setPk(data.publishableKey) })
      .catch(() => {})
    checkPlan()
      .then((info) => setSub({ id: info.subscription_id, planId: info.plan_id ?? info.plan }))
      .catch(() => {})
      .finally(() => setResolved(true))
  }, [])

  // Wait for the custom elements (registered by v1.js in index.html).
  useEffect(() => {
    if (ready) return
    let alive = true
    Promise.all([
      customElements.whenDefined('myappbuddy-license-manager'),
      customElements.whenDefined('myappbuddy-pricing-table'),
    ]).then(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [ready])

  // Only the coordinator (account owner) may view/change the subscription.
  if (profile && profile.role !== 'coordinator') {
    return <Navigate to={roleHome(profile.role, org?.org_type)} replace />
  }

  const loading = !ready || !resolved || !pk

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
        {loading && (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-muted)' }}><span className="spinner" /></div>
        )}

        {!loading && !pk && (
          <div className="alert alert-error">Couldn't load your subscription just now. Please try again in a moment.</div>
        )}

        {!loading && pk && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Current subscription + manage/cancel */}
            {sub.id && (
              <WidgetBoundary fallback={null}>
                <MabEmbed tag="myappbuddy-license-manager" attrs={{
                  subscription: sub.id,
                  'publishable-key': pk,
                }} />
              </WidgetBoundary>
            )}

            {/* Available plans (highlights the current plan by id) */}
            <WidgetBoundary fallback={null}>
              <MabEmbed tag="myappbuddy-pricing-table" attrs={{
                app: 'companion',
                'publishable-key': pk,
                currency: 'AUD',
                ...(sub.planId ? { 'current-plan': sub.planId } : {}),
              }} />
            </WidgetBoundary>
          </div>
        )}
      </div>
    </div>
  )
}
