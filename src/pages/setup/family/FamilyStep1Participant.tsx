import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabase'

export default function FamilyStep1Participant() {
  const navigate = useNavigate()
  const { user, refreshProfile } = useAuth()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleContinue() {
    if (!name.trim() || !user) return
    setSaving(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('setup_family_org', {
        p_participant_name: name.trim(),
      })
      if (rpcError) throw rpcError
      await refreshProfile()
      navigate('/setup/family/invite')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Step 1 of 3</p>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        Who are you caring for?
      </h1>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
        This creates their care journal where you and your family can log their day.
      </p>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>
      )}

      <div className="field" style={{ marginBottom: '1.5rem' }}>
        <label htmlFor="participant-name">Their name</label>
        <input
          id="participant-name"
          className="input"
          placeholder="e.g. Liam"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleContinue()}
          autoFocus
        />
      </div>

      <button
        className="btn btn-primary btn-full"
        onClick={handleContinue}
        disabled={!name.trim() || saving}
        style={{ fontSize: '1rem' }}
      >
        {saving ? <span className="spinner" /> : 'Continue →'}
      </button>
    </div>
  )
}
