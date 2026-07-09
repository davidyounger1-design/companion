import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { SEVERITY_LABEL, CATEGORY_LABEL } from '../lib/incidents'
import type { IncidentSeverity, IncidentCategory } from '../types/database'

const SEVERITIES: IncidentSeverity[] = ['low', 'medium', 'high', 'critical']
const CATEGORIES: IncidentCategory[] = ['injury', 'behaviour', 'medication', 'property', 'near_miss', 'complaint', 'other']

export default function IncidentForm({
  clientId,
  orgId,
  authorId,
  onSaved,
  onCancel,
}: {
  clientId: string
  orgId: string
  authorId: string
  onSaved: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [severity, setSeverity] = useState<IncidentSeverity>('low')
  const [category, setCategory] = useState<IncidentCategory>('other')
  const [description, setDescription] = useState('')
  const [immediateAction, setImmediateAction] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('incidents').insert({
        client_id: clientId,
        org_id: orgId,
        author_id: authorId,
        occurred_at: new Date(occurredAt).toISOString(),
        severity,
        category,
        description: description.trim(),
        immediate_action: immediateAction.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents', clientId] })
      qc.invalidateQueries({ queryKey: ['open-incidents'] })
      onSaved()
    },
  })

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>Report an incident</p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!description.trim()) return
          save.mutate()
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div className="field">
          <label htmlFor="inc-occurred">When did this happen?</label>
          <input id="inc-occurred" type="datetime-local" className="input" value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="inc-severity">Severity</label>
            <select id="inc-severity" className="input" value={severity}
              onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="inc-category">Category</label>
            <select id="inc-category" className="input" value={category}
              onChange={(e) => setCategory(e.target.value as IncidentCategory)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="inc-description">What happened?</label>
          <textarea id="inc-description" className="input" rows={3} style={{ resize: 'vertical' }}
            placeholder="Describe what happened, in as much detail as you can"
            value={description} onChange={(e) => setDescription(e.target.value)} autoFocus />
        </div>

        <div className="field">
          <label htmlFor="inc-action">
            Immediate action taken <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <textarea id="inc-action" className="input" rows={2} style={{ resize: 'vertical' }}
            placeholder="e.g. First aid applied, supervisor notified, participant settled"
            value={immediateAction} onChange={(e) => setImmediateAction(e.target.value)} />
        </div>

        {save.isError && (
          <div className="alert alert-error">
            {save.error instanceof Error ? save.error.message : 'Could not save. Try again.'}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending || !description.trim()} style={{ flex: 2 }}>
            {save.isPending ? <span className="spinner" /> : 'Submit report'}
          </button>
        </div>
      </form>
    </div>
  )
}
