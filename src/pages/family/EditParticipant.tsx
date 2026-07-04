import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

export default function EditParticipant() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  const { data: clientRow, isLoading } = useQuery({
    queryKey: ['family-client-id', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_family')
        .select('client_id, clients(full_name, dob)')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return data
    },
    enabled: !!user,
  })

  const client = clientRow?.clients as unknown as { full_name: string; dob: string | null } | null
  const clientId = clientRow?.client_id

  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [initialised, setInitialised] = useState(false)

  // Pre-fill once data arrives
  if (client && !initialised) {
    setName(client.full_name)
    setDob(client.dob ?? '')
    setInitialised(true)
  }

  async function handleSave() {
    if (!name.trim() || !clientId) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase
      .from('clients')
      .update({ full_name: name.trim(), dob: dob || null })
      .eq('id', clientId)
    setSaving(false)
    if (err) { setError(err.message); return }
    qc.invalidateQueries({ queryKey: ['family-client'] })
    qc.invalidateQueries({ queryKey: ['family-client-id'] })
    navigate('/family')
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.875rem 1rem',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        position: 'sticky',
        top: 'var(--family-header-h, 0px)',
        zIndex: 10,
      }}>
        <button
          className="btn btn-ghost"
          onClick={() => navigate('/family')}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}
        >
          ← Cancel
        </button>
        <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>Edit participant</span>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={!name.trim() || saving || isLoading}
          style={{ fontSize: '0.875rem' }}
        >
          {saving ? <span className="spinner" /> : 'Save'}
        </button>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '1.5rem 1rem' }}>
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
          </div>
        ) : (
          <>
            {error && (
              <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>
            )}

            <div className="field" style={{ marginBottom: '1.25rem' }}>
              <label htmlFor="participant-name">Full name</label>
              <input
                id="participant-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="field">
              <label htmlFor="participant-dob">
                Date of birth{' '}
                <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
              </label>
              <input
                id="participant-dob"
                type="date"
                className="input"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
