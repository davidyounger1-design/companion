import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

export default function Step0Account() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [saving, setSaving] = useState(false)

  // If the coordinator already has an org, skip to service step
  if (profile?.org_id) {
    navigate('/setup/service')
    return null
  }

  const needsName = !profile?.full_name

  async function handleContinue() {
    if (needsName && name.trim()) {
      setSaving(true)
      await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', user!.id)
      setSaving(false)
    }
    navigate('/setup/service')
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        Your account is ready
      </h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '2rem' }}>
        Now let's set up your organisation. This takes about 5 minutes.
      </p>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Signed in as</p>
        {needsName ? (
          <div className="field" style={{ marginBottom: '0.25rem' }}>
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
        ) : (
          <p style={{ fontWeight: 600, fontSize: '1rem', margin: 0 }}>{profile.full_name}</p>
        )}
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.25rem' }}>
          Role: Coordinator
        </p>
      </div>

      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
        You'll set up your organisation details, choose a plan, invite your team, and add your first participants.
        Your 14-day free trial starts when you choose a plan.
      </p>

      <button
        className="btn btn-primary btn-full"
        onClick={handleContinue}
        disabled={saving || (needsName && !name.trim())}
        style={{ fontSize: '1rem' }}
      >
        {saving ? <span className="spinner" /> : 'Continue to service details →'}
      </button>
    </div>
  )
}
