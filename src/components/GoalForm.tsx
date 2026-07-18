import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { GOAL_CATEGORY_LABEL } from '../lib/ndisRecords'
import type { GoalCategory } from '../types/database'

const CATEGORIES = Object.keys(GOAL_CATEGORY_LABEL) as GoalCategory[]

export default function GoalForm({
  clientId,
  orgId,
  createdBy,
  onSaved,
  onCancel,
}: {
  clientId: string
  orgId: string
  createdBy: string
  onSaved: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [category, setCategory] = useState<GoalCategory | ''>('')

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('participant_goals').insert({
        client_id: clientId,
        org_id: orgId,
        title: title.trim(),
        description: description.trim() || null,
        target_date: targetDate || null,
        category: category || null,
        created_by: createdBy,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['participant-goals', clientId] })
      onSaved()
    },
  })

  return (
    <div className="card" style={{ marginBottom: '1.25rem' }}>
      <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>New goal</p>
      <form
        onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; save.mutate() }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div className="field">
          <label htmlFor="goal-title">Goal</label>
          <input id="goal-title" className="input" placeholder="e.g. Use public transport independently"
            value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="goal-description">
            Details <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <textarea id="goal-description" className="input" rows={2} style={{ resize: 'vertical' }}
            placeholder="What does success look like for this goal?"
            value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="goal-target">
            Target date <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <input id="goal-target" type="date" className="input" value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="goal-category">
            Category <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <select id="goal-category" className="input" value={category}
            onChange={(e) => setCategory(e.target.value as GoalCategory | '')}>
            <option value="">No category</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{GOAL_CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        {save.isError && (
          <div className="alert alert-error">
            {save.error instanceof Error ? save.error.message : 'Could not save. Try again.'}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending || !title.trim()} style={{ flex: 2 }}>
            {save.isPending ? <span className="spinner" /> : 'Add goal'}
          </button>
        </div>
      </form>
    </div>
  )
}
