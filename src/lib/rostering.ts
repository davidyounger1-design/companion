// Shared helpers for the Rostering feature (coordinator + worker surfaces).
// Design: docs/superpowers/specs/2026-08-24-rostering-design.md

export const SHIFT_STATUSES = ['draft', 'published', 'confirmed', 'in_progress', 'completed', 'cancelled'] as const
export type ShiftStatus = (typeof SHIFT_STATUSES)[number]

export const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  confirmed: 'Confirmed',
  in_progress: 'On shift',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const STATUS_COLOR: Record<ShiftStatus, { bg: string; fg: string }> = {
  draft: { bg: 'color-mix(in srgb, var(--color-muted) 20%, transparent)', fg: 'var(--color-muted)' },
  published: { bg: 'color-mix(in srgb, var(--color-primary) 18%, transparent)', fg: 'var(--color-primary)' },
  confirmed: { bg: 'color-mix(in srgb, #16a34a 18%, transparent)', fg: '#16a34a' },
  in_progress: { bg: 'color-mix(in srgb, #f59e0b 22%, transparent)', fg: '#b45309' },
  completed: { bg: 'color-mix(in srgb, var(--color-muted) 15%, transparent)', fg: 'var(--color-muted)' },
  cancelled: { bg: 'color-mix(in srgb, var(--color-error) 15%, transparent)', fg: 'var(--color-error)' },
}

export const DAY_LABELS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const DAY_LABELS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** ISO date (YYYY-MM-DD) for the Monday on/before the given date, UTC-based —
 * matches the week-grid's own UTC-day bucketing rule (§5.1: "day of starts_at"). */
export function weekStartOf(d: Date): string {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dow = utc.getUTCDay() // 0=Sun..6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow
  utc.setUTCDate(utc.getUTCDate() + diffToMonday)
  return utc.toISOString().slice(0, 10)
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const d = new Date(isoDate + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** UTC day index (0=Sun..6=Sat) of an ISO date string, matching the week grid's own bucketing rule. */
export function isoDateDow(isoDate: string): number {
  return new Date(isoDate + 'T00:00:00Z').getUTCDay()
}

/** UTC day (YYYY-MM-DD) a timestamptz falls on — the week-grid's own bucketing rule. */
export function utcDayOf(timestamptz: string): string {
  return timestamptz.slice(0, 10)
}

export function formatTimeRange(startsAt: string, endsAt: string): string {
  const fmt = (s: string) => new Date(s).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  return `${fmt(startsAt)}–${fmt(endsAt)}`
}

export function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00Z')
  const end = new Date(weekStart + 'T00:00:00Z')
  end.setUTCDate(end.getUTCDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${start.toLocaleDateString('en-AU', opts)} – ${end.toLocaleDateString('en-AU', opts)}`
}

export type WeekGridShift = {
  id: string
  worker_id: string | null
  worker_name: string | null
  is_open: boolean
  status: ShiftStatus
  starts_at: string
  ends_at: string
  required_skills: string[]
  notes: string | null
  template_id: string | null
  participants: Array<{ id: string; full_name: string }> | null
}

export type RosteringWarnings = {
  overlaps: Array<{ worker_id: string; shift_a: string; shift_b: string }>
  uncovered: Array<{ participant_id: string; day: string }>
  unconfirmed: Array<{ id: string; starts_at: string }>
}
