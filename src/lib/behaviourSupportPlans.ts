/** Format an ISO date (review_due / created_at are plain dates, not datetimes). */
export function formatBspDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/** True when a review_due date is set and has already passed. */
export function isReviewOverdue(reviewDue: string | null, now = new Date()) {
  if (!reviewDue) return false
  const due = new Date(reviewDue)
  if (Number.isNaN(due.getTime())) return false
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return due.getTime() < startOfToday
}
