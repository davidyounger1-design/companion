import { NoticesIcon, TrashIcon } from './icons'

const NOTICE_COLOR = 'var(--color-amber)'

/** A posted notice — shared by the full Notice Board and the Journal's
 * inline "active notices" preview, so the same card reads identically in
 * both places. */
export default function NoticeCard({
  body, authorName, dateLabel, canDelete, onDelete,
}: {
  body: string
  authorName: string
  dateLabel: string
  canDelete: boolean
  onDelete: () => void
}) {
  return (
    <div className="card" style={{ marginBottom: '0.75rem', position: 'relative', padding: '0.9rem 1rem 0.9rem 1.1rem', overflow: 'hidden' }}>
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: NOTICE_COLOR }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
        <span className="avatar avatar-sm" style={{ background: NOTICE_COLOR, marginTop: 1 }}><NoticesIcon size={15} /></span>
        <div style={{ flex: 1, minWidth: 0, paddingRight: canDelete ? '1.75rem' : 0 }}>
          <p style={{ margin: '0 0 0.3rem', fontSize: 'var(--text-base)', fontWeight: 500, lineHeight: 1.5 }}>{body}</p>
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{authorName} · {dateLabel}</p>
        </div>
      </div>
      {canDelete && (
        <button onClick={onDelete} aria-label="Delete notice" className="icon-btn icon-btn-danger" style={{
          position: 'absolute', top: 8, right: 8, width: 30, height: 30,
        }}><TrashIcon size={15} /></button>
      )}
    </div>
  )
}
