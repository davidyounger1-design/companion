import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { checkPlan, planMeters } from '../../lib/planCheck'

export default function Step4Clients() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, profile, org } = useAuth()
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [orgId, setOrgId] = useState<string | null>(profile?.org_id ?? null)
  const [orgLoading, setOrgLoading] = useState(!profile?.org_id)

  // Seat quota: on a participant-metered plan, cap active participant records
  // at the subscription's seats. FAIL OPEN — if seats/plan can't be read, or
  // the plan isn't participant-metered, never block adding a participant.
  const [activeCount, setActiveCount] = useState<number | null>(null)
  const [seats, setSeats] = useState<number | null>(null)
  const [meteredAxis, setMeteredAxis] = useState<ReturnType<typeof planMeters>>(null)

  useEffect(() => {
    if (!orgId) return
    supabase.from('clients').select('id', { count: 'exact', head: true })
      .eq('org_id', orgId).eq('active', true)
      .then(({ count }) => { if (typeof count === 'number') setActiveCount(count) })
    checkPlan().then((info) => {
      setSeats(info.seats)
      setMeteredAxis(planMeters(info.plan_id ?? org?.plan ?? null))
    }).catch(() => {})
  }, [orgId])

  const capReached = meteredAxis === 'participants' && seats != null && activeCount != null && activeCount >= seats

  useEffect(() => {
    if (orgId) { setOrgLoading(false); return }
    setOrgLoading(true)
    supabase
      .from('profiles')
      .select('org_id')
      .eq('id', user?.id ?? '')
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) console.error('[Step4] profile fetch error:', err)
        if (data?.org_id) {
          setOrgId(data.org_id)
        } else {
          setError('Your organisation could not be found. Try going back to Step 2 and saving again.')
        }
        setOrgLoading(false)
      })
  }, [user?.id])

  async function addClient() {
    setError('')
    if (!name.trim()) return
    if (!orgId) {
      setError('Organisation not loaded yet — wait a moment and try again.')
      return
    }
    if (capReached) {
      setError(`You've reached your plan's limit of ${seats} participant${seats === 1 ? '' : 's'}. Increase your plan quantity to add more.`)
      return
    }
    setSaving(true)
    const { error: err } = await supabase.from('clients').insert({
      org_id: orgId,
      full_name: name.trim(),
      dob: dob || null,
      active: true,
    })
    setSaving(false)
    if (err) {
      setError(err.message)
    } else {
      qc.invalidateQueries({ queryKey: ['clients', orgId] })
      setAdded((prev) => [...prev, name.trim()])
      setActiveCount((prev) => (prev ?? 0) + 1)
      setName('')
      setDob('')
    }
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>Add your first participants</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '2rem' }}>
        You can add more at any time from the dashboard.
      </p>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      )}
      {!error && capReached && (
        <div className="alert" style={{ marginBottom: '1rem' }}>
          You've reached your plan's limit of {seats} participant{seats === 1 ? '' : 's'}. Increase your plan quantity to add more.
        </div>
      )}

      {orgLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
          <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>Loading organisation…</p>
        </div>
      ) : orgId && !capReached ? (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <div className="field" style={{ marginBottom: '0.75rem' }}>
            <label htmlFor="clientName">Full name</label>
            <input
              id="clientName"
              className="input"
              placeholder="Alex Smith"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !saving && name.trim() && addClient()}
              autoFocus
            />
          </div>
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="clientDob">
              Date of birth <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
            </label>
            <input
              id="clientDob"
              type="date"
              className="input"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={addClient}
            disabled={saving || !name.trim()}
          >
            {saving ? <span className="spinner" /> : 'Add participant'}
          </button>
        </div>
      ) : null}

      {added.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Added this session</p>
          {added.map((n) => (
            <p key={n} style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: '0.25rem 0' }}>
              ✓ {n}
            </p>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button className="btn btn-ghost btn-full" onClick={() => navigate('/setup/circles')}>
          Skip for now
        </button>
        <button
          className="btn btn-primary btn-full"
          onClick={() => navigate('/setup/circles')}
          disabled={added.length === 0}
        >
          Continue →
        </button>
      </div>
    </div>
  )
}
