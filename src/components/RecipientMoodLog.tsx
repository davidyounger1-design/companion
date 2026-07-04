import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import MoodSlider, { moodEmoji, moodColor } from './MoodSlider'
import type { RecipientMood } from '../types/database'

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return `Today · ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
  if (diffDays === 1) return `Yesterday · ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

/**
 * A recipient's own self-reported mood check-in — separate from the
 * mood_score attached to journal entries others write about them (which
 * recipients no longer see). The recipient can log how they're feeling
 * whenever they like; everyone with access to them sees the history.
 */
export default function RecipientMoodLog({
  clientId, orgId, participantName,
}: { clientId: string; orgId: string; participantName: string }) {
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const isRecipient = profile?.role === 'recipient'
  const [showForm, setShowForm] = useState(false)
  const [value, setValue] = useState(50)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { data: moods = [], isLoading } = useQuery({
    queryKey: ['recipient-moods', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recipient_moods')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data as RecipientMood[]
    },
    enabled: !!clientId,
  })

  async function handleSubmit() {
    if (!user) return
    setSubmitting(true)
    const { error } = await supabase.from('recipient_moods').insert({
      client_id: clientId, org_id: orgId, author_id: user.id,
      mood_score: value, note: note.trim() || null,
    })
    setSubmitting(false)
    if (!error) {
      setNote('')
      setValue(50)
      setShowForm(false)
      qc.invalidateQueries({ queryKey: ['recipient-moods', clientId] })
    }
  }

  const latest = moods[0]

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9375rem' }}>
          {isRecipient ? 'How are you feeling?' : `${participantName}'s mood`}
        </p>
        {latest && <span style={{ fontSize: '1.3rem' }} title={formatDate(latest.created_at)}>{moodEmoji(latest.mood_score)}</span>}
      </div>

      {isRecipient && !showForm && (
        <button className="btn btn-secondary" style={{ marginTop: '0.75rem', width: '100%', fontSize: '0.875rem' }} onClick={() => setShowForm(true)}>
          Log how I'm feeling
        </button>
      )}

      {isRecipient && showForm && (
        <div style={{ marginTop: '0.75rem' }}>
          <MoodSlider value={value} onChange={setValue} />
          <textarea className="input" rows={2} placeholder="Anything you want to add? (optional)"
            value={note} onChange={(e) => setNote(e.target.value)} style={{ resize: 'vertical', marginBottom: '0.6rem' }} />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-primary" style={{ flex: 2 }} onClick={handleSubmit} disabled={submitting}>
              {submitting ? <span className="spinner" /> : 'Save'}
            </button>
          </div>
        </div>
      )}

      {!isLoading && moods.length > 0 && (
        <div style={{ marginTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
          {moods.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
              <span>{moodEmoji(m.mood_score)}</span>
              <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--color-border)' }}>
                <div style={{ width: `${m.mood_score}%`, height: '100%', borderRadius: 2, background: moodColor(m.mood_score) }} />
              </div>
              <span style={{ color: 'var(--color-muted)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{formatDate(m.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {!isLoading && moods.length === 0 && (
        <p style={{ margin: '0.75rem 0 0', fontSize: '0.82rem', color: 'var(--color-muted)' }}>
          {isRecipient ? "You haven't logged a mood yet." : `No mood check-ins from ${participantName} yet.`}
        </p>
      )}
    </div>
  )
}
