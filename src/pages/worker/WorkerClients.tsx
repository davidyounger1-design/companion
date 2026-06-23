import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

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
