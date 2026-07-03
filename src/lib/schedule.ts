import type { ScheduleCategory, ScheduleItem } from '../types/database'

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_LABELS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const CATEGORY_META: Record<ScheduleCategory, { label: string; emoji: string; color: string; badge: string }> = {
  therapy:       { label: 'Therapy',       emoji: '🧘', color: 'var(--color-sage)',       badge: 'badge-sage' },
  meal:          { label: 'Meal',          emoji: '🍽️', color: 'var(--color-amber)',      badge: 'badge-amber' },
  activity:      { label: 'Activity',      emoji: '🎨', color: 'var(--color-terracotta)', badge: 'badge-terra' },
  personal_care: { label: 'Personal care', emoji: '🛁', color: 'var(--color-sky)',        badge: 'badge-sky' },
  social:        { label: 'Social',        emoji: '👋', color: 'var(--color-lavender)',   badge: 'badge-lavender' },
  appointment:   { label: 'Appointment',   emoji: '📅', color: 'var(--color-rose)',       badge: 'badge-rose' },
  other:         { label: 'Other',         emoji: '⭐', color: 'var(--color-muted)',      badge: 'badge-muted' },
}

export const CATEGORY_OPTIONS = Object.keys(CATEGORY_META) as ScheduleCategory[]

/** 'YYYY-MM-DD' in local time, matching the convention used elsewhere (e.g. FamilyDashboard's toLocalDate). */
export function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Parses a 'YYYY-MM-DD' string as a local-midnight Date (avoids UTC-shift bugs from `new Date('YYYY-MM-DD')`). */
export function parseLocalDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Minutes since midnight for a Postgres 'HH:MM:SS' time string. */
export function timeToMinutes(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function formatTimeOfDay(t: string) {
  const [h, m] = t.split(':').map(Number)
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

export function formatTimeRange(startTime: string, endTime: string | null) {
  if (!endTime) return formatTimeOfDay(startTime)
  return `${formatTimeOfDay(startTime)} – ${formatTimeOfDay(endTime)}`
}

/** Whether a schedule item occurs on the given local date. */
export function occursOnDate(item: Pick<ScheduleItem, 'recurrence' | 'specific_date' | 'days_of_week'>, dateStr: string) {
  if (item.recurrence === 'once') return item.specific_date === dateStr
  const dow = parseLocalDate(dateStr).getDay()
  return (item.days_of_week ?? []).includes(dow)
}

export type ItemStatus = 'current' | 'next' | 'upcoming' | 'past'

/** Live status of an item, only meaningful when viewing today. */
export function getItemStatus(item: Pick<ScheduleItem, 'start_time' | 'end_time'>, nowMinutes: number): ItemStatus {
  const start = timeToMinutes(item.start_time)
  const end = item.end_time ? timeToMinutes(item.end_time) : start + 1
  if (nowMinutes >= start && nowMinutes < end) return 'current'
  if (nowMinutes < start) return 'upcoming'
  return 'past'
}

/** "in 45 min" / "in 2 hr 10 min" / "starting now" for the gap between now and a future minute-of-day. */
export function formatCountdown(nowMinutes: number, targetMinutes: number) {
  const diff = targetMinutes - nowMinutes
  if (diff <= 0) return 'starting now'
  const hours = Math.floor(diff / 60)
  const mins = diff % 60
  if (hours === 0) return `in ${mins} min`
  if (mins === 0) return `in ${hours} hr`
  return `in ${hours} hr ${mins} min`
}
