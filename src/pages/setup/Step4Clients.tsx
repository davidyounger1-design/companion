import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function Step4Clients() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user, profile } = useAuth()
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [orgId, setOrgId] = useState<string | null>(profile?.org_id ?? null)
  const [orgLoading, setOrgLoading] = useState(!profile?.org_id)

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

      {orgLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
          <p style={{ color: 'var(--color-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>Loading organisation…</p>
        </div>
      ) : orgId ? (
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
