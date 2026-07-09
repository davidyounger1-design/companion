import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import GoalForm from './GoalForm'
import GoalCard from './GoalCard'
import type { GoalStatus } from '../types/database'

type Goal = {
  id: string; client_id: string; org_id: string
  title: string; description: string | null; target_date: string | null
  status: GoalStatus
}

export default function NdisRecordsSection({
  clientId,
  orgId,
  authorId,
  /** Coordinators can add goals and mark them achieved/discontinued. */
  canManageGoals,
}: {
  clientId: string
  orgId: string
  authorId: string
  canManageGoals: boolean
}) {
  const [showGoalForm, setShowGoalForm] = useState(false)

  const { data: goals, isLoading } = useQuery({
    queryKey: ['participant-goals', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('participant_goals')
        .select('id, client_id, org_id, title, description, target_date, status')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Goal[]
    },
    enabled: !!clientId,
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '1rem', fontFamily: 'var(--font-ui)', fontWeight: 700, margin: 0 }}>Goals & progress</h2>
        {canManageGoals && !showGoalForm && (
          <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
            onClick={() => setShowGoalForm(true)}>
            + Add goal
          </button>
        )}
      </div>

      {showGoalForm && (
        <GoalForm clientId={clientId} orgId={orgId} createdBy={authorId}
          onSaved={() => setShowGoalForm(false)} onCancel={() => setShowGoalForm(false)} />
      )}

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : !goals?.length ? (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
          No goals set yet.
        </p>
      ) : (
        <div className="scroll-list">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} authorId={authorId} canManage={canManageGoals} />
          ))}
        </div>
      )}
    </div>
  )
}
