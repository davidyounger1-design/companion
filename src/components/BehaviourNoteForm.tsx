import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { moodEmoji5 } from '../lib/behaviourNotes'

const MOOD_SCALE = [1, 2, 3, 4, 5]

function MoodPicker({ value, onChange, label }: { value: number | null; onChange: (v: number | null) => void; label: string }) {
  return (
    <div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-muted)', margin: '0 0 0.35rem' }}>{label}</p>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        {MOOD_SCALE.map((score) => (
          <button
            key={score}
            type="button"
            onClick={() => onChange(value === score ? null : score)}
            style={{
              flex: 1,
              fontSize: '1.2rem',
              padding: '0.4rem 0',
              borderRadius: 8,
              border: `1.5px solid ${value === score ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: value === score ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'var(--color-surface)',
              cursor: 'pointer',
            }}
          >
            {moodEmoji5(score)}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function BehaviourNoteForm({
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
  const [title, setTitle] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 16))
  const [moodBefore, setMoodBefore] = useState<number | null>(null)
  const [moodAfter, setMoodAfter] = useState<number | null>(null)
  const [antecedent, setAntecedent] = useState('')
  const [behaviour, setBehaviour] = useState('')
  const [response, setResponse] = useState('')
  const [flagged, setFlagged] = useState(false)

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('behaviour_notes').insert({
        client_id: clientId,
        org_id: orgId,
        author_id: authorId,
        title: title.trim(),
        occurred_at: new Date(occurredAt).toISOString(),
        mood_before: moodBefore,
        mood_after: moodAfter,
        antecedent: antecedent.trim() || null,
        behaviour: behaviour.trim() || null,
        response: response.trim() || null,
        flagged_for_review: flagged,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['behaviour-notes', clientId] })
      qc.invalidateQueries({ queryKey: ['flagged-notes'] })
      onSaved()
    },
  })

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>New behaviour note</p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          save.mutate()
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        <div className="field">
          <label htmlFor="bn-title">Title</label>
          <input id="bn-title" className="input" placeholder="e.g. Situation at lunch" value={title}
            onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        <div className="field">
          <label htmlFor="bn-occurred">When did this happen?</label>
          <input id="bn-occurred" type="datetime-local" className="input" value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <div style={{ flex: 1 }}><MoodPicker value={moodBefore} onChange={setMoodBefore} label="Mood before" /></div>
          <div style={{ flex: 1 }}><MoodPicker value={moodAfter} onChange={setMoodAfter} label="Mood after" /></div>
        </div>

        <div className="field">
          <label htmlFor="bn-antecedent">Antecedent — what led up to it?</label>
          <textarea id="bn-antecedent" className="input" rows={2} style={{ resize: 'vertical' }}
            placeholder="e.g. Transition from art to lunch room, unfamiliar faces at table"
            value={antecedent} onChange={(e) => setAntecedent(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="bn-behaviour">Behaviour — what did they do?</label>
          <textarea id="bn-behaviour" className="input" rows={2} style={{ resize: 'vertical' }}
            placeholder="e.g. Raised voice, paced near door, declined food"
            value={behaviour} onChange={(e) => setBehaviour(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="bn-response">Response — what helped?</label>
          <textarea id="bn-response" className="input" rows={2} style={{ resize: 'vertical' }}
            placeholder="e.g. Offered quiet corner, familiar playlist. Settled within 10 min"
            value={response} onChange={(e) => setResponse(e.target.value)} />
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
          Flag for coordinator review
        </label>

        {save.isError && (
          <div className="alert alert-error">
            {save.error instanceof Error ? save.error.message : 'Could not save. Try again.'}
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} style={{ flex: 1 }}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending || !title.trim()} style={{ flex: 2 }}>
            {save.isPending ? <span className="spinner" /> : 'Save note'}
          </button>
        </div>
      </form>
    </div>
  )
}
