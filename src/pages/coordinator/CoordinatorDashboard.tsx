import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useFeatures } from '../../hooks/useFeatures'
import { FEATURES } from '../../lib/features'
import { signOut } from '../../lib/auth'
import { useState } from 'react'
import { SettingsIcon } from '../../components/icons'
import ColorModePill from '../../components/ColorModePill'
import ClientManagePanel from '../../components/ClientManagePanel'

export default function CoordinatorDashboard() {
  const { profile } = useAuth()
  const { has } = useFeatures()
  const navigate = useNavigate()
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null)

  const { data: clients, isLoading: clientsLoading } = useQuery({
    queryKey: ['clients', profile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('org_id', profile!.org_id!)
        .order('full_name')
      if (error) throw error
      return data
    },
    enabled: !!profile?.org_id,
  })

  const { data: openIncidents } = useQuery({
    queryKey: ['open-incidents', profile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('incidents')
        .select('id')
        .eq('org_id', profile!.org_id!)
        .in('status', ['open', 'escalated'])
      if (error) throw error
      return data
    },
    enabled: !!profile?.org_id && has(FEATURES.incidentWorkflows),
  })

  const { data: flaggedNotes } = useQuery({
    queryKey: ['flagged-notes', profile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('behaviour_notes')
        .select('id')
        .eq('org_id', profile!.org_id!)
        .eq('flagged_for_review', true)
      if (error) throw error
      return data
    },
    enabled: !!profile?.org_id,
  })

  const { data: todayLogs } = useQuery({
    queryKey: ['today-logs', profile?.org_id],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('log_entries')
        .select('client_id')
        .eq('org_id', profile!.org_id!)
        .gte('occurred_at', `${today}T00:00:00`)
      if (error) throw error
      return data
    },
    enabled: !!profile?.org_id,
  })

  // Org-wide workforce overview — a provider_dashboard feature. Base dashboard
  // (stats above, per-participant management below) works the same with or
  // without this; it only adds the aggregate command-centre view.
  const showWorkforce = has(FEATURES.providerDashboard)

  const { data: workerCount } = useQuery({
    queryKey: ['org-worker-count', profile?.org_id],
    queryFn: async () => {
      const { count } = await supabase
        .from('profiles').select('id', { count: 'exact', head: true })
        .eq('org_id', profile!.org_id!)
        .in('role', ['support_worker', 'trusted_support_worker'])
      return count ?? 0
    },
    enabled: !!profile?.org_id && showWorkforce,
  })

  const { data: clientWorkerRows } = useQuery({
    queryKey: ['org-client-workers', profile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_workers')
        .select('client_id, worker_id')
        .in('client_id', (clients ?? []).map((c) => c.id))
      if (error) throw error
      return data ?? []
    },
    enabled: !!profile?.org_id && showWorkforce && !!clients?.length,
  })

  const loggedClientIds = new Set(todayLogs?.map((l) => l.client_id))
  const activeClients = clients?.filter((c) => c.active) ?? []
  const loggedToday = activeClients.filter((c) => loggedClientIds.has(c.id)).length

  const workerCountByClient = new Map<string, number>()
  for (const row of clientWorkerRows ?? []) {
    workerCountByClient.set(row.client_id, (workerCountByClient.get(row.client_id) ?? 0) + 1)
  }
  const unassignedCount = activeClients.filter((c) => !workerCountByClient.get(c.id)).length

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      {/* Header */}
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
        padding: '1rem 1.5rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 600 }}>Companion</span>
          <span className="badge badge-sage" style={{ marginLeft: '0.6rem' }}>Coordinator</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
          <ColorModePill />
          <Link to="/help" className="btn btn-ghost" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
            Help
          </Link>
          <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => navigate('/settings/display')} style={{ flexShrink: 0 }}>
            <SettingsIcon size={18} />
          </button>
          <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
            Sign out
          </button>
        </div>
      </header>

      <main style={{ padding: '1.5rem', maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 400, marginBottom: '0.25rem' }}>
          Good {timeOfDay()}, {firstName(profile?.full_name)}
        </h1>
        <p style={{ color: 'var(--color-muted)', marginBottom: '1.75rem', fontSize: '0.9rem' }}>
          {new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          <StatCard
            label="Active participants"
            value={clientsLoading ? '…' : String(activeClients.length)}
            icon="👥"
          />
          <StatCard
            label="Logged today"
            value={clientsLoading ? '…' : `${loggedToday} / ${activeClients.length}`}
            icon="✅"
          />
          {has(FEATURES.behaviourNotes) && (
            <StatCard
              label="Needs review"
              value={flaggedNotes ? String(flaggedNotes.length) : '…'}
              icon="🔍"
            />
          )}
          {showWorkforce && (
            <StatCard
              label="Workers"
              value={workerCount != null ? String(workerCount) : '…'}
              icon="🧑‍🤝‍🧑"
            />
          )}
          {showWorkforce && unassignedCount > 0 && (
            <StatCard
              label="Needs a worker"
              value={String(unassignedCount)}
              icon="⚠️"
            />
          )}
          {has(FEATURES.incidentWorkflows) && (
            <StatCard
              label="Open incidents"
              value={openIncidents ? String(openIncidents.length) : '…'}
              icon="🚨"
            />
          )}
        </div>

        {/* Participants */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontFamily: 'var(--font-ui)', fontWeight: 700, margin: 0 }}>Participants</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link to="/members" className="btn btn-ghost" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
              Members
            </Link>
            <Link to="/setup/clients" className="btn btn-secondary" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>
              + Add participant
            </Link>
          </div>
        </div>

        {clientsLoading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
          </div>
        ) : activeClients.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <p style={{ color: 'var(--color-muted)', marginBottom: '1rem' }}>No participants yet.</p>
            <Link to="/setup/clients" className="btn btn-primary">Add your first participant</Link>
          </div>
        ) : (
          <div className="scroll-list">
            {activeClients.map((client) => (
              <div key={client.id} className="card card-sm" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1rem', cursor: 'pointer' }}
                  onClick={() => setExpandedClientId((id) => (id === client.id ? null : client.id))}
                >
                  <div>
                    <p style={{ fontWeight: 600, margin: 0 }}>{client.full_name}</p>
                    {client.setting && (
                      <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '0.2rem' }}>{client.setting}</p>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {showWorkforce && (
                      workerCountByClient.get(client.id) ? (
                        <span className="badge badge-muted">{workerCountByClient.get(client.id)} worker{workerCountByClient.get(client.id) === 1 ? '' : 's'}</span>
                      ) : (
                        <span className="badge" style={{ background: 'color-mix(in srgb, var(--color-error) 15%, transparent)', color: 'var(--color-error)' }}>No worker</span>
                      )
                    )}
                    {loggedClientIds.has(client.id) ? (
                      <span className="badge badge-sage">Logged</span>
                    ) : (
                      <span className="badge badge-muted">Not logged</span>
                    )}
                    <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{expandedClientId === client.id ? '▲' : '▼'}</span>
                  </div>
                </div>
                {expandedClientId === client.id && (
                  <ClientManagePanel clientId={client.id} participantName={client.full_name} orgId={profile!.org_id!} />
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="card card-sm">
      <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{icon}</div>
      <p style={{ fontSize: '1.6rem', fontFamily: 'var(--font-display)', fontWeight: 600, margin: '0 0 0.2rem' }}>{value}</p>
      <p className="eyebrow" style={{ margin: 0 }}>{label}</p>
    </div>
  )
}

function timeOfDay() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function firstName(name?: string | null) {
  return name?.split(' ')[0] ?? 'there'
}
