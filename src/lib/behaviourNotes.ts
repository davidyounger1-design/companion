import { supabase } from './supabase'
import type { BehaviourNote } from '../types/database'

const MOOD_EMOJI: Record<number, string> = { 1: '😔', 2: '😕', 3: '😐', 4: '🙂', 5: '😊' }

export function moodEmoji5(score: number | null | undefined) {
  if (!score) return null
  return MOOD_EMOJI[score] ?? null
}

export function formatNoteDate(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export async function logNoteAccess(noteId: string, actorId: string, action: 'view' | 'share' | 'revoke') {
  await supabase.from('access_log').insert({ note_id: noteId, actor_id: actorId, action })
}

export function notesToCsv(notes: BehaviourNote[]) {
  const header = ['Date', 'Title', 'Mood before', 'Mood after', 'Antecedent', 'Behaviour', 'Response', 'Flagged for review']
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`
  const rows = notes.map((n) => [
    new Date(n.occurred_at).toLocaleString('en-AU'),
    n.title,
    n.mood_before != null ? String(n.mood_before) : '',
    n.mood_after != null ? String(n.mood_after) : '',
    n.antecedent ?? '',
    n.behaviour ?? '',
    n.response ?? '',
    n.flagged_for_review ? 'Yes' : 'No',
  ].map(escape).join(','))
  return [header.map(escape).join(','), ...rows].join('\n')
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
