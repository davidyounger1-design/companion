import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { RATING_LABEL } from '../lib/ndisRecords'
import type { ProgressRating } from '../types/database'

const RATINGS: ProgressRating[] = ['regressed', 'no_change', 'some_progress', 'good_progress', 'achieved']

export default function ProgressRecordForm({
  goalId,
  clientId,
  orgId,
  authorId,
  onSaved,
  onCancel,
}: {
  goalId: string
  clientId: string
  orgId: string
  authorId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const [rating, setRating] = useState<ProgressRating>('some_progress')
  const [notes, setNotes] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('goal_progress_records').insert({
        goal_id: goalId,
        client_id: clientId,
        org_id: orgId,
        author_id: authorId,
        rating,
        notes: notes.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goal-progress', goalId] })
      onSaved()
    },
  })

  return (
    <div style={{ background: 'var(--color-surface)', borderRadius: 8, padding: '0.75rem', marginTop: '0.5rem' }}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (!notes.trim()) return; save.mutate() }}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
      >
        <div className="field">
          <label htmlFor="progress-rating">How's it going?</label>
          <select id="progress-rating" className="input" value={rating}
            onChange={(e) => setRating(e.target.value as ProgressRating)}>
            {RATINGS.map((r) => <option key={r} value={r}>{RATING_LABEL[r]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="progress-notes">Notes</label>
          <textarea id="progress-notes" className="input" rows={2} style={{ resize: 'vertical' }}
            placeholder="What did you observe?"
            value={notes} onChange={(e) => setNotes(e.target.value)} autoFocus />
        </div>
        {save.isError && (
          <div className="alert alert-error">
            {save.error instanceof Error ? save.error.message : 'Could not save. Try again.'}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ flex: 1, fontSize: '0.8rem' }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending || !notes.trim()} style={{ flex: 2, fontSize: '0.8rem' }}>
            {save.isPending ? <span className="spinner" /> : 'Log progress'}
          </button>
        </div>
      </form>
    </div>
  )
}
