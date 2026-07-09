import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import ProgressRecordForm from './ProgressRecordForm'
import { GOAL_STATUS_LABEL, GOAL_STATUS_COLOR, RATING_LABEL, RATING_EMOJI, formatGoalDate, formatProgressDate } from '../lib/ndisRecords'
import type { ProgressRating, GoalStatus } from '../types/database'

type Goal = {
  id: string; client_id: string; org_id: string
  title: string; description: string | null; target_date: string | null
  status: GoalStatus
}

type ProgressRecordRow = {
  id: string
  occurred_at: string
  rating: ProgressRating
  notes: string
  profiles: { full_name: string } | null
}

export default function GoalCard({
  goal,
  authorId,
  canManage,
}: {
  goal: Goal
  authorId: string
  canManage: boolean
}) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [showProgressForm, setShowProgressForm] = useState(false)

  const { data: records } = useQuery({
    queryKey: ['goal-progress', goal.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('goal_progress_records')
        .select('id, occurred_at, rating, notes, profiles!author_id(full_name)')
        .eq('goal_id', goal.id)
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ProgressRecordRow[]
    },
    enabled: expanded,
  })

  const setGoalStatus = useMutation({
    mutationFn: async (status: 'achieved' | 'discontinued') => {
      const { error } = await supabase.from('participant_goals').update({ status }).eq('id', goal.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['participant-goals', goal.client_id] }),
  })

  const st = GOAL_STATUS_COLOR[goal.status]

  return (
    <div className="card card-sm">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer' }}
        onClick={() => setExpanded((x) => !x)}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <p style={{ margin: 0, fontWeight: 600 }}>{goal.title}</p>
            <span className="badge" style={{ background: st.bg, color: st.fg, fontSize: '0.65rem' }}>{GOAL_STATUS_LABEL[goal.status]}</span>
          </div>
          {goal.description && (
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--color-muted)' }}>{goal.description}</p>
          )}
          {goal.target_date && (
            <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
              Target: {formatGoalDate(goal.target_date)}
            </p>
          )}
        </div>
        <span style={{ fontSize: '0.7rem', opacity: 0.6, marginLeft: '0.5rem' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--color-border)', paddingTop: '0.75rem' }}>
          {!records?.length ? (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.82rem', margin: '0 0 0.5rem' }}>No progress logged yet.</p>
          ) : (
            records.map((r) => (
              <div key={r.id} style={{ display: 'flex', gap: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ fontSize: '1rem', flexShrink: 0 }}>{RATING_EMOJI[r.rating]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: '0.82rem' }}>{r.notes}</p>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', color: 'var(--color-muted)' }}>
                    {RATING_LABEL[r.rating]} · {formatProgressDate(r.occurred_at)}{r.profiles?.full_name ? ` · ${r.profiles.full_name}` : ''}
                  </p>
                </div>
              </div>
            ))
          )}

          {goal.status === 'active' && (
            !showProgressForm ? (
              <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem', marginTop: '0.5rem' }}
                onClick={(e) => { e.stopPropagation(); setShowProgressForm(true) }}>
                + Log progress
              </button>
            ) : (
              <div onClick={(e) => e.stopPropagation()}>
                <ProgressRecordForm
                  goalId={goal.id} clientId={goal.client_id} orgId={goal.org_id} authorId={authorId}
                  onSaved={() => setShowProgressForm(false)} onCancel={() => setShowProgressForm(false)}
                />
              </div>
            )
          )}

          {canManage && goal.status === 'active' && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                disabled={setGoalStatus.isPending} onClick={() => setGoalStatus.mutate('achieved')}>
                Mark achieved
              </button>
              <button className="btn btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.6rem' }}
                disabled={setGoalStatus.isPending} onClick={() => setGoalStatus.mutate('discontinued')}>
                Discontinue
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
