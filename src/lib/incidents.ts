import type { IncidentSeverity, IncidentCategory, IncidentStatus } from '../types/database'

export const SEVERITY_LABEL: Record<IncidentSeverity, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
}

export const SEVERITY_COLOR: Record<IncidentSeverity, { fg: string; bg: string }> = {
  low:      { fg: 'var(--color-muted)', bg: 'color-mix(in srgb, var(--color-muted) 15%, transparent)' },
  medium:   { fg: '#b8860b',            bg: 'color-mix(in srgb, #b8860b 15%, transparent)' },
  high:     { fg: '#c0392b',            bg: 'color-mix(in srgb, #c0392b 15%, transparent)' },
  critical: { fg: '#fff',               bg: '#c0392b' },
}

export const CATEGORY_LABEL: Record<IncidentCategory, string> = {
  injury: 'Injury', behaviour: 'Behaviour', medication: 'Medication',
  property: 'Property damage', near_miss: 'Near miss', complaint: 'Complaint', other: 'Other',
}

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: 'Open', escalated: 'Escalated', resolved: 'Resolved',
}

export const STATUS_COLOR: Record<IncidentStatus, { fg: string; bg: string }> = {
  open:      { fg: 'var(--color-primary-deep)', bg: 'color-mix(in srgb, var(--color-primary) 15%, transparent)' },
  escalated: { fg: '#c0392b',                   bg: 'color-mix(in srgb, #c0392b 15%, transparent)' },
  resolved:  { fg: 'var(--color-muted)',        bg: 'color-mix(in srgb, var(--color-muted) 15%, transparent)' },
}

export function formatIncidentDate(iso: string) {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
