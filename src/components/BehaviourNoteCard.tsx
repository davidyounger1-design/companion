import type { BehaviourNote } from '../types/database'
import { moodEmoji5, formatNoteDate } from '../lib/behaviourNotes'

export default function BehaviourNoteCard({
  note,
  onClick,
  subtitle,
}: {
  note: BehaviourNote
  onClick?: () => void
  subtitle?: string
}) {
  return (
    <div
      className="card card-sm"
      onClick={onClick}
      style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', cursor: onClick ? 'pointer' : 'default' }}
    >
      <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{moodEmoji5(note.mood_after ?? note.mood_before) ?? '📋'}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <p style={{ margin: 0, fontWeight: 500 }}>{note.title}</p>
          {note.flagged_for_review && (
            <span className="badge" style={{ background: 'color-mix(in srgb, #ef4444 15%, transparent)', color: '#ef4444', fontSize: '0.65rem' }}>
              Flagged
            </span>
          )}
        </div>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
          {formatNoteDate(note.occurred_at)}
          {subtitle ? ` · ${subtitle}` : ''}
        </p>
      </div>
    </div>
  )
}
