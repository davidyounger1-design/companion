import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { BehaviourNote } from '../types/database'
import { moodEmoji5, formatNoteDate, logNoteAccess } from '../lib/behaviourNotes'
import Toggle from './Toggle'

type CircleTherapist = { therapist_id: string; profiles: { full_name: string } | null }
type ShareRow = { id: string; therapist_id: string; revoked_at: string | null }
type AccessRow = { id: string; action: string; created_at: string; profiles: { full_name: string } | null }

export default function BehaviourNoteDetail({
  note,
  clientId,
  canShare,
  canViewAccessLog,
  logViewAsTherapist,
  onClose,
}: {
  note: BehaviourNote
  clientId: string
  canShare: boolean
  canViewAccessLog: boolean
  logViewAsTherapist: boolean
  onClose: () => void
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const loggedView = useRef(false)

  useEffect(() => {
    if (logViewAsTherapist && user && !loggedView.current) {
      loggedView.current = true
      logNoteAccess(note.id, user.id, 'view')
    }
  }, [logViewAsTherapist, user, note.id])

  const { data: circle } = useQuery({
    queryKey: ['client-circle', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_circle')
        .select('therapist_id, profiles!therapist_id(full_name)')
        .eq('client_id', clientId)
        .eq('status', 'in_circle')
      if (error) throw error
      return (data ?? []) as unknown as CircleTherapist[]
    },
    enabled: canShare,
  })

  const { data: shares } = useQuery({
    queryKey: ['note-shares', note.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('note_shares')
        .select('id, therapist_id, revoked_at')
        .eq('note_id', note.id)
      if (error) throw error
      return (data ?? []) as ShareRow[]
    },
    enabled: canShare,
  })

  const { data: accessLog } = useQuery({
    queryKey: ['access-log', note.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('access_log')
        .select('id, action, created_at, profiles!actor_id(full_name)')
        .eq('note_id', note.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as AccessRow[]
    },
    enabled: canViewAccessLog,
  })

  const [busyTherapistId, setBusyTherapistId] = useState<string | null>(null)

  async function toggleShare(therapistId: string) {
    if (!user) return
    setBusyTherapistId(therapistId)
    const existing = shares?.find((s) => s.therapist_id === therapistId)
    const isShared = !!existing && !existing.revoked_at
    if (isShared && existing) {
      await supabase.from('note_shares').update({ revoked_at: new Date().toISOString() }).eq('id', existing.id)
      await logNoteAccess(note.id, user.id, 'revoke')
    } else if (existing) {
      await supabase.from('note_shares').update({ revoked_at: null }).eq('id', existing.id)
      await logNoteAccess(note.id, user.id, 'share')
    } else {
      await supabase.from('note_shares').insert({ note_id: note.id, therapist_id: therapistId, shared_by: user.id })
      await logNoteAccess(note.id, user.id, 'share')
    }
    setBusyTherapistId(null)
    qc.invalidateQueries({ queryKey: ['note-shares', note.id] })
    qc.invalidateQueries({ queryKey: ['access-log', note.id] })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <div>
            <p className="eyebrow" style={{ marginBottom: '0.35rem' }}>Behaviour note</p>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 400, margin: 0 }}>{note.title}</h2>
          </div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>

        <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', marginBottom: '1rem' }}>
          {formatNoteDate(note.occurred_at)}
          {note.flagged_for_review && (
            <span className="badge" style={{ marginLeft: '0.5rem', background: 'color-mix(in srgb, #ef4444 15%, transparent)', color: '#ef4444', fontSize: '0.65rem' }}>
              Flagged for review
            </span>
          )}
        </p>

        {(note.mood_before != null || note.mood_after != null) && (
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.25rem' }}>
            {note.mood_before != null && (
              <div>
                <p style={{ fontSize: '0.72rem', color: 'var(--color-muted)', margin: '0 0 0.15rem' }}>Mood before</p>
                <p style={{ fontSize: '1.1rem', margin: 0 }}>{moodEmoji5(note.mood_before)}</p>
              </div>
            )}
            {note.mood_after != null && (
              <div>
                <p style={{ fontSize: '0.72rem', color: 'var(--color-muted)', margin: '0 0 0.15rem' }}>Mood after</p>
                <p style={{ fontSize: '1.1rem', margin: 0 }}>{moodEmoji5(note.mood_after)}</p>
              </div>
            )}
          </div>
        )}

        {(['antecedent', 'behaviour', 'response'] as const).map((field) =>
          note[field] ? (
            <div key={field} style={{ marginBottom: '0.9rem' }}>
              <p style={{ fontSize: '0.7rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)', margin: '0 0 0.25rem' }}>
                {field}
              </p>
              <p style={{ fontSize: '0.9rem', lineHeight: 1.6, margin: 0, background: 'var(--color-surface)', borderRadius: 8, padding: '0.6rem 0.75rem' }}>
                {note[field]}
              </p>
            </div>
          ) : null
        )}

        {canShare && (
          <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
            <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.75rem' }}>Share with therapists</p>
            {!circle?.length ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>No therapists in this person's circle yet.</p>
            ) : (
              circle.map((t) => {
                const existing = shares?.find((s) => s.therapist_id === t.therapist_id)
                const isShared = !!existing && !existing.revoked_at
                return (
                  <div key={t.therapist_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>
                    <span style={{ fontSize: '0.9rem' }}>{t.profiles?.full_name ?? 'Therapist'}</span>
                    <Toggle
                      checked={isShared}
                      disabled={busyTherapistId === t.therapist_id}
                      onChange={() => toggleShare(t.therapist_id)}
                      label={`Share with ${t.profiles?.full_name ?? 'therapist'}`}
                    />
                  </div>
                )
              })
            )}
          </div>
        )}

        {canViewAccessLog && (
          <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--color-border)', paddingTop: '1rem' }}>
            <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.75rem' }}>Access log</p>
            {!accessLog?.length ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>No access recorded yet.</p>
            ) : (
              accessLog.map((a) => (
                <p key={a.id} style={{ fontSize: '0.8rem', color: 'var(--color-muted)', margin: '0.3rem 0' }}>
                  <strong style={{ color: 'var(--color-ink)' }}>{a.profiles?.full_name ?? 'Someone'}</strong>{' '}
                  {a.action === 'view' ? 'viewed' : a.action === 'share' ? 'was shared this note' : 'had access revoked'}
                  {' · '}{formatNoteDate(a.created_at)}
                </p>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
