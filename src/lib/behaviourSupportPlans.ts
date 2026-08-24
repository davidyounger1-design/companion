import { parseLocalDate } from './schedule'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** Format a plan date. review_due arrives as 'YYYY-MM-DD' — parsed as local
 * midnight via parseLocalDate (new Date('YYYY-MM-DD') shifts a day west of
 * UTC); created_at arrives as a full timestamptz, so Date() is correct. */
export function formatBspDate(iso: string) {
  const d = DATE_ONLY.test(iso) ? parseLocalDate(iso) : new Date(iso)
  return d.toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/** True when a review_due date is set and has already passed (compared against
 * the local start of today). */
export function isReviewOverdue(reviewDue: string | null, now = new Date()) {
  if (!reviewDue) return false
  const due = parseLocalDate(reviewDue)
  if (Number.isNaN(due.getTime())) return false
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return due.getTime() < startOfToday
}
