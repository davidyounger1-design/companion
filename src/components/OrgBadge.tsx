import { useAuth } from '../context/AuthContext'

/** Persistent "which tenancy am I in" indicator — a provider org's own name,
 * shown next to the Companion brand mark in every role's header so it's
 * never ambiguous which organisation's data is on screen. */
export default function OrgBadge() {
  const { org } = useAuth()
  if (!org?.name) return null
  return (
    <span
      title={org.name}
      style={{
        fontSize: '0.7rem',
        fontWeight: 600,
        color: 'var(--color-muted)',
        maxWidth: '9rem',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {org.name}
    </span>
  )
}
