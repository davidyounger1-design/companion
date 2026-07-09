import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import IncidentCard from './IncidentCard'
import IncidentDetail from './IncidentDetail'
import type { Incident } from '../types/database'

export default function IncidentsSection({
  clientId,
  canManage,
}: {
  clientId: string
  /** Coordinators can escalate/resolve; workers can view and add reports only. */
  canManage: boolean
}) {
  const [selected, setSelected] = useState<Incident | null>(null)

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['incidents', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('incidents')
        .select('*')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return data as Incident[]
    },
    enabled: !!clientId,
  })

  return (
    <div>
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : !incidents?.length ? (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
          No incidents reported.
        </p>
      ) : (
        <div className="scroll-list">
          {incidents.map((incident) => (
            <IncidentCard key={incident.id} incident={incident} onClick={() => setSelected(incident)} />
          ))}
        </div>
      )}

      {selected && (
        <IncidentDetail incident={selected} canManage={canManage} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}
