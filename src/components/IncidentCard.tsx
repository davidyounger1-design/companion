import type { Incident } from '../types/database'
import { SEVERITY_LABEL, SEVERITY_COLOR, STATUS_LABEL, STATUS_COLOR, CATEGORY_LABEL, formatIncidentDate } from '../lib/incidents'

export default function IncidentCard({ incident, onClick }: { incident: Incident; onClick?: () => void }) {
  const sev = SEVERITY_COLOR[incident.severity]
  const st = STATUS_COLOR[incident.status]
  return (
    <div className="card card-sm" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.35rem' }}>
        <span className="badge" style={{ background: sev.bg, color: sev.fg, fontSize: '0.65rem' }}>
          {SEVERITY_LABEL[incident.severity]}
        </span>
        <span className="badge" style={{ background: st.bg, color: st.fg, fontSize: '0.65rem' }}>
          {STATUS_LABEL[incident.status]}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>{CATEGORY_LABEL[incident.category]}</span>
      </div>
      <p style={{ margin: 0, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {incident.description}
      </p>
      <p style={{ margin: '0.3rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
        {formatIncidentDate(incident.occurred_at)}
      </p>
    </div>
  )
}
