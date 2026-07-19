import { useState } from 'react'
import { NoticesIcon, TrashIcon, EditIcon } from './icons'

const NOTICE_COLOR = 'var(--color-amber)'

/** A posted notice — shared by the full Notice Board and the Journal's
 * inline "active notices" preview, so the same card reads identically in
 * both places. */
export default function NoticeCard({
  body, authorName, dateLabel, canDelete, onDelete, canEdit, onEdit,
}: {
  body: string
  authorName: string
  dateLabel: string
  canDelete: boolean
  onDelete: () => void
  canEdit?: boolean
  onEdit?: (body: string) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(body)
  const [saving, setSaving] = useState(false)
  const actionSlots = (canDelete ? 1 : 0) + (canEdit ? 1 : 0)

  async function save() {
    if (!draft.trim() || !onEdit) return
    setSaving(true)
    try {
      await onEdit(draft.trim())
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="card" style={{ marginBottom: '0.75rem', position: 'relative', padding: '0.9rem 1rem 0.9rem 1.1rem', overflow: 'hidden' }}>
        <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: NOTICE_COLOR }} />
        <textarea className="input" rows={3} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ resize: 'vertical', marginBottom: '0.6rem' }} autoFocus />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={save} disabled={saving || !draft.trim()} style={{ fontSize: '0.875rem' }}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
          <button className="btn" onClick={() => { setDraft(body); setEditing(false) }} disabled={saving} style={{ fontSize: '0.875rem' }}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: '0.75rem', position: 'relative', padding: '0.9rem 1rem 0.9rem 1.1rem', overflow: 'hidden' }}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: NOTICE_COLOR }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <span className="avatar avatar-sm" style={{ background: NOTICE_COLOR, marginTop: 1 }}><NoticesIcon size={15} /></span>
        <div style={{ flex: 1, minWidth: 0, paddingRight: actionSlots ? `${actionSlots * 1.9}rem` : 0 }}>
          <p style={{ margin: '0 0 0.3rem', fontSize: 'var(--text-base)', fontWeight: 500, lineHeight: 1.5 }}>{body}</p>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{authorName} · {dateLabel}</p>
        </div>
      </div>
      {canEdit && (
        <button onClick={() => setEditing(true)} aria-label="Edit notice" className="icon-btn" style={{
          position: 'absolute', top: 8, right: canDelete ? 42 : 8, width: 30, height: 30,
        }}><EditIcon size={15} /></button>
      )}
      {canDelete && (
        <button onClick={onDelete} aria-label="Delete notice" className="icon-btn icon-btn-danger" style={{
          position: 'absolute', top: 8, right: 8, width: 30, height: 30,
        }}><TrashIcon size={15} /></button>
      )}
    </div>
  )
}
