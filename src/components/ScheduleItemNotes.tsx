import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { ScheduleItemNote } from '../types/database'

type NoteWithAuthor = ScheduleItemNote & { author_name?: string }

function formatNoteTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function ScheduleItemNotes({
  scheduleItemId, occurrenceDate, clientId, orgId,
}: { scheduleItemId: string; occurrenceDate: string; clientId: string; orgId: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const queryKey = ['schedule-item-notes', scheduleItemId, occurrenceDate]

  const { data: notes = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_item_notes')
        .select('*, profiles!author_id(full_name)')
        .eq('schedule_item_id', scheduleItemId)
        .eq('occurrence_date', occurrenceDate)
        .order('created_at', { ascending: true })
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((n: any) => ({ ...n, author_name: n.profiles?.full_name })) as NoteWithAuthor[]
    },
    enabled: expanded,
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim() || !user) return
    setSubmitting(true)
    setError('')
    const { error: insertError } = await supabase.from('schedule_item_notes').insert({
      schedule_item_id: scheduleItemId,
      occurrence_date: occurrenceDate,
      client_id: clientId,
      org_id: orgId,
      author_id: user.id,
      body: body.trim(),
    })
    setSubmitting(false)
    if (insertError) { setError(insertError.message); return }
    setBody('')
    qc.invalidateQueries({ queryKey })
  }

  return (
    <div style={{ marginTop: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontSize: '0.75rem', color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem',
        }}
      >
        📝 {expanded ? 'Hide notes' : notes.length > 0 ? `Notes (${notes.length})` : 'Add a note'}
      </button>

      {expanded && (
        <div style={{ marginTop: '0.5rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--color-border)' }}>
          {isLoading && (
            <div style={{ padding: '0.5rem 0' }}>
              <span className="spinner" style={{ width: 16, height: 16 }} />
            </div>
          )}
          {!isLoading && notes.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: '0.25rem 0 0.5rem' }}>No notes yet for this one.</p>
          )}
          {notes.map((n) => (
            <div key={n.id} style={{ margin: '0.4rem 0' }}>
              <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>{n.body}</p>
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.68rem', color: 'var(--color-muted)' }}>
                {n.author_name ?? 'Someone'} · {formatNoteTime(n.created_at)}
              </p>
            </div>
          ))}
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
            <input
              className="input"
              placeholder="Add a note…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
            />
            <button type="submit" className="btn btn-ghost" disabled={submitting || !body.trim()}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem', flexShrink: 0 }}>
              {submitting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Post'}
            </button>
          </form>
          {error && <div className="alert alert-error" style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
