import { supabase } from './supabase'

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

/** Trigger a browser download of an in-memory blob (CSV, PDF, …). */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadCsv(filename: string, csv: string) {
  downloadBlob(filename, new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
}
