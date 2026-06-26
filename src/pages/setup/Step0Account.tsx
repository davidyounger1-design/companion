import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { checkPlan, isFamilyPlan } from '../../lib/planCheck'

type PlanChoice = 'family' | 'provider' | null

export default function Step0Account() {
  const navigate = useNavigate()
  const { user, profile, org } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [saving, setSaving] = useState(false)
  const [planLoading, setPlanLoading] = useState(false)
  const [isFamily, setIsFamily] = useState(false)
  const [chosenType, setChosenType] = useState<PlanChoice>(() => {
    if (localStorage.getItem('companion.intendedPlan') === 'family') return 'family'
    return null
  })

  // Redirect if org already set up
  useEffect(() => {
    if (!profile?.org_id) return
    if (profile.role === 'family') {
      navigate('/family', { replace: true })
    } else if (profile.role === 'coordinator') {
      if (org?.org_type === 'family') {
        navigate('/family', { replace: true })
      } else {
        navigate('/setup/service', { replace: true })
      }
    } else if (profile.role === 'support_worker' || profile.role === 'trusted_support_worker') {
      navigate('/worker', { replace: true })
    } else {
      navigate('/setup/service', { replace: true })
    }
  }, [profile?.org_id, profile?.role])

  // Check subscription plan — if Stripe says family, skip the chooser
  useEffect(() => {
    if (!user || profile?.org_id) return
    setPlanLoading(true)
    checkPlan().then((info) => {
      setIsFamily(isFamilyPlan(info.plan))
      setPlanLoading(false)
    })
  }, [user?.id, profile?.org_id])

  // Auto-navigate when family plan was pre-selected (via landing page CTA) and name already set
  useEffect(() => {
    if (profile?.org_id) return
    if (chosenType === 'family' && !planLoading && profile?.full_name) {
      localStorage.removeItem('companion.intendedPlan')
      navigate('/setup/family/participant', { replace: true })
    }
  }, [chosenType, planLoading, profile?.org_id, profile?.full_name])

  if (profile?.org_id) return null

  const needsName = !profile?.full_name
  // Stripe confirmed family OR user explicitly chose
  const resolvedType: PlanChoice = isFamily ? 'family' : chosenType
  const canContinue = !planLoading && !saving && (!needsName || name.trim()) && resolvedType !== null

  async function handleContinue() {
    if (needsName && name.trim()) {
      setSaving(true)
      await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', user!.id)
      setSaving(false)
    }
    if (resolvedType === 'family') {
      navigate('/setup/family/participant')
    } else {
      navigate('/setup/service')
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        Your account is ready
      </h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '2rem' }}>
        Tell us how you'll be using Companion.
      </p>

      {/* Name input */}
      {needsName && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="displayName">Your name</label>
            <input
              id="displayName"
              className="input"
              placeholder="Sarah Johnson"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
        </div>
      )}

      {/* Plan type chooser — only shown when Stripe hasn't confirmed family */}
      {!planLoading && !isFamily && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <button
            type="button"
            onClick={() => setChosenType('family')}
            style={{
              textAlign: 'left',
              padding: '1rem 1.25rem',
              borderRadius: 12,
              border: `2px solid ${chosenType === 'family' ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: chosenType === 'family' ? 'var(--color-primary-subtle, #f0faf6)' : 'var(--color-surface)',
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <p style={{ fontWeight: 600, margin: '0 0 0.2rem', fontSize: '0.9375rem' }}>
              Family care journal
            </p>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
              Free · One participant · Track daily care moments
            </p>
          </button>

          <button
            type="button"
            onClick={() => setChosenType('provider')}
            style={{
              textAlign: 'left',
              padding: '1rem 1.25rem',
              borderRadius: 12,
              border: `2px solid ${chosenType === 'provider' ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: chosenType === 'provider' ? 'var(--color-primary-subtle, #f0faf6)' : 'var(--color-surface)',
              cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            <p style={{ fontWeight: 600, margin: '0 0 0.2rem', fontSize: '0.9375rem' }}>
              Support provider / Organisation
            </p>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-muted)' }}>
              14-day free trial · Multiple participants · Team management
            </p>
          </button>
        </div>
      )}

      {planLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
          <div className="spinner" style={{ width: 28, height: 28, color: 'var(--color-primary)' }} />
        </div>
      )}

      <button
        className="btn btn-primary btn-full"
        onClick={handleContinue}
        disabled={!canContinue}
        style={{ fontSize: '1rem' }}
      >
        {saving
          ? <span className="spinner" />
          : resolvedType === 'family'
            ? 'Set up care journal →'
            : resolvedType === 'provider'
              ? 'Continue to service details →'
              : 'Select a plan above'}
      </button>
    </div>
  )
}
