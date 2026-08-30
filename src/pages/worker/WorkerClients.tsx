import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useFeatures } from '../../hooks/useFeatures'
import { FEATURES } from '../../lib/features'
import { errorMessage } from '../../lib/errorMessage'
import { formatTimeRange } from '../../lib/rostering'

export default function WorkerClients() {
  const { user } = useAuth()

  const { data: clients, isLoading } = useQuery({
    queryKey: ['worker-clients', user?.id],
    queryFn: async () => {
      // Get client IDs assigned to this worker
      const { data: assignments, error: aErr } = await supabase
        .from('client_workers')
        .select('client_id')
        .eq('worker_id', user!.id)
      if (aErr) throw aErr

      if (!assignments?.length) return []

      const clientIds = assignments.map((a) => a.client_id)
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .in('id', clientIds)
        .eq('active', true)
        .order('full_name')
      if (error) throw error
      return data
    },
    enabled: !!user,
  })

  // Today's log counts per client
  const { data: todayLogs } = useQuery({
    queryKey: ['today-logs-worker', user?.id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('log_entries')
        .select('client_id')
        .eq('author_id', user!.id)
        .gte('occurred_at', `${today}T00:00:00`)
      if (error) throw error
      return data
    },
    enabled: !!user,
  })

  const loggedToday = new Set(todayLogs?.map((l) => l.client_id))

  return (
    <div className="page">
      <p className="eyebrow" style={{ marginBottom: '0.4rem' }}>
        {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 400, marginBottom: '1.5rem' }}>My clients</h1>

      <TodayShiftCard />

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : !clients?.length ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <p style={{ color: 'var(--color-muted)' }}>No clients assigned yet.</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>Ask your coordinator to assign you to a client.</p>
        </div>
      ) : (
        <div className="scroll-list">
          {clients.map((client) => (
            <Link
              key={client.id}
              to={`/worker/clients/${client.id}`}
              style={{ textDecoration: 'none' }}
            >
              <div className="card card-sm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontWeight: 600, margin: 0, color: 'var(--color-ink)' }}>{client.full_name}</p>
                  {client.setting && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '0.2rem' }}>{client.setting}</p>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {loggedToday.has(client.id) ? (
                    <span className="badge badge-sage">Logged ✓</span>
                  ) : (
                    <span className="badge badge-muted">Log shift →</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// Rostering: today's shift, with a Start button, or the active-shift card
// once started (§5.4). No shift → no card. Gated on FEATURES.rostering —
// `has()` returns false while loading/on error, so "absent" is the default.
function TodayShiftCard() {
  const { user } = useAuth()
  const { has } = useFeatures()
  const qc = useQueryClient()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const enabled = !!user && has(FEATURES.rostering)

  const { data: shift, refetch } = useQuery({
    queryKey: ['worker-today-shift', user?.id],
    queryFn: async () => {
      const { data: inProgress } = await supabase
        .from('shifts').select('*').eq('worker_id', user!.id).eq('status', 'in_progress').is('deleted_at', null)
        .limit(1).maybeSingle()
      if (inProgress) return inProgress

      const today = new Date().toISOString().slice(0, 10)
      const { data: todays } = await supabase
        .from('shifts').select('*').eq('worker_id', user!.id).in('status', ['published', 'confirmed']).is('deleted_at', null)
        .gte('starts_at', `${today}T00:00:00Z`).lt('starts_at', `${today}T23:59:59.999Z`)
        .order('starts_at').limit(1).maybeSingle()
      return todays ?? null
    },
    enabled,
  })

  const { data: participantIds } = useQuery({
    queryKey: ['shift-participant-ids', shift?.id],
    queryFn: async () => {
      const { data } = await supabase.from('shift_participants').select('participant_id').eq('shift_id', shift!.id).is('left_at', null)
      return (data ?? []).map((r) => r.participant_id)
    },
    enabled: !!shift?.id,
  })

  const isActive = shift?.status === 'in_progress'

  // Previous-handover banner only before the first log entry of the shift (§3.4/§5.1).
  const { data: alreadyLogged } = useQuery({
    queryKey: ['worker-logged-since-shift-start', shift?.id],
    queryFn: async () => {
      const { data } = await supabase.from('log_entries').select('id').eq('author_id', user!.id).gte('occurred_at', shift!.starts_at).limit(1)
      return (data ?? []).length > 0
    },
    enabled: !!shift && isActive,
  })

  const { data: previousHandover } = useQuery({
    queryKey: ['previous-handover', shift?.id],
    queryFn: async () => {
      const { data, error: err } = await supabase.rpc('rostering_previous_handover', {
        p_program_id: shift!.program_id, p_participant_ids: participantIds ?? [], p_before: shift!.starts_at,
      })
      if (err) throw err
      return data as { body: string | null; nothing_to_hand_over: boolean; fallback_no_shared_participants: boolean } | null
    },
    enabled: !!shift && isActive && !!participantIds && alreadyLogged === false,
  })

  async function handleStart() {
    if (!shift) return
    setStarting(true); setError('')
    try {
      const { error: err } = await supabase.rpc('rostering_start_shift', { p_shift_id: shift.id })
      if (err) throw err
      refetch()
      qc.invalidateQueries({ queryKey: ['worker-my-shifts'] })
    } catch (e) {
      setError(errorMessage(e, 'Could not start this shift.'))
    } finally {
      setStarting(false)
    }
  }

  if (!enabled || !shift) return null

  return (
    <div className="card" style={{ marginBottom: '1.5rem', borderLeft: '3px solid var(--color-primary)' }}>
      <p className="eyebrow" style={{ marginBottom: '0.3rem' }}>{isActive ? 'On shift' : "Today's shift"}</p>
      <p style={{ fontWeight: 600, margin: '0 0 0.5rem' }}>{formatTimeRange(shift.starts_at, shift.ends_at)}</p>

      {previousHandover && (
        <div style={{ background: 'var(--color-surface)', borderRadius: 8, padding: '0.6rem 0.75rem', marginBottom: '0.6rem', fontSize: '0.85rem' }}>
          <p style={{ fontWeight: 600, margin: '0 0 0.25rem', fontSize: '0.75rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Previous handover{previousHandover.fallback_no_shared_participants ? ' (no shared participants)' : ''}
          </p>
          <p style={{ margin: 0 }}>{previousHandover.nothing_to_hand_over ? 'Nothing to hand over.' : previousHandover.body}</p>
        </div>
      )}

      {error && <p style={{ fontSize: '0.8rem', color: 'var(--color-error)', marginBottom: '0.5rem' }}>{error}</p>}

      {isActive ? (
        <Link to="/worker/shifts" className="btn btn-secondary" style={{ fontSize: '0.82rem', textDecoration: 'none' }}>
          End shift in My shifts →
        </Link>
      ) : (
        <button className="btn btn-primary" style={{ fontSize: '0.82rem' }} disabled={starting} onClick={handleStart}>
          {starting ? <span className="spinner" /> : 'Start shift'}
        </button>
      )}
    </div>
  )
}
