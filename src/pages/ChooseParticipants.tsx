import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { roleHome } from '../lib/roleHome'

/** Shown when a plan downgrade leaves more active participants than the new
 * plan allows (nobody's prompted at downgrade time — that happens entirely
 * in MAB's portal). The coordinator picks which participants to keep active;
 * the rest are deactivated the same way as a manual deactivate (reversible —
 * see ClientManagePanel), not deleted. */
export default function ChooseParticipants() {
  const { profile, org, refreshProfile } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const orgId = profile?.org_id
  const seats = org?.seats ?? 1

  const { data: clients, isLoading } = useQuery({
    queryKey: ['active-clients-for-seat-picker', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, full_name')
        .eq('org_id', orgId!)
        .eq('active', true)
        .order('full_name')
      if (error) throw error
      return data
    },
    enabled: !!orgId,
  })

  const [selected, setSelected] = useState<string[] | null>(null)
  const chosen = selected ?? clients?.slice(0, seats).map((c) => c.id) ?? []

  function toggle(id: string) {
    const base = selected ?? clients?.slice(0, seats).map((c) => c.id) ?? []
    if (base.includes(id)) {
      setSelected(base.filter((x) => x !== id))
    } else if (base.length < seats) {
      setSelected([...base, id])
    } else if (seats === 1) {
      setSelected([id])
    }
  }

  const confirm = useMutation({
    mutationFn: async () => {
      const toDeactivate = (clients ?? []).filter((c) => !chosen.includes(c.id)).map((c) => c.id)
      if (toDeactivate.length) {
        const { error } = await supabase.from('clients').update({ active: false }).in('id', toDeactivate)
        if (error) throw error
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['active-clients-for-seat-picker', orgId] })
      await refreshProfile()
      navigate(roleHome(profile?.role, org?.org_type), { replace: true })
    },
  })

  if (isLoading) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ color: 'var(--color-primary)' }} />
      </div>
    )
  }

  const overBy = (clients?.length ?? 0) - seats

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem', background: 'var(--color-bg)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 480, padding: '2rem' }}>
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Plan change</p>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 400, marginBottom: '0.5rem' }}>Choose who to keep active</h1>
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          Your current plan allows {seats} active participant{seats === 1 ? '' : 's'}, but you have {clients?.length ?? 0}.
          Pick {seats === 1 ? 'which one' : `up to ${seats}`} to keep active — the rest will be deactivated
          {overBy > 0 ? ` (${overBy} to deactivate)` : ''}. Nothing is deleted, and you can reactivate anyone later if you upgrade again.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {(clients ?? []).map((c) => {
            const isChosen = chosen.includes(c.id)
            return (
              <label
                key={c.id}
                className="card"
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1rem',
                  cursor: 'pointer', border: isChosen ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                }}
              >
                <input
                  type={seats === 1 ? 'radio' : 'checkbox'}
                  name="keep-participant"
                  checked={isChosen}
                  onChange={() => toggle(c.id)}
                  disabled={!isChosen && chosen.length >= seats && seats !== 1}
                />
                <span style={{ fontWeight: 500 }}>{c.full_name}</span>
              </label>
            )
          })}
        </div>

        {confirm.isError && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            {(confirm.error as Error).message}
          </div>
        )}

        <button
          className="btn btn-primary btn-full"
          disabled={chosen.length === 0 || chosen.length > seats || confirm.isPending}
          onClick={() => confirm.mutate()}
          style={{ fontSize: '1rem' }}
        >
          {confirm.isPending ? <span className="spinner" /> : 'Confirm'}
        </button>
      </div>
    </div>
  )
}
