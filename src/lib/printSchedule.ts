import { CATEGORY_META, formatTimeRange } from './schedule'
import type { ScheduleItem } from '../types/database'

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return s.replace(/[&<>"']/g, (c) => map[c])
}

export type PrintDaySection = { label: string; items: ScheduleItem[] }

/**
 * Builds a self-contained HTML document (no dependency on the app's own
 * stylesheet, theme, or React tree) and opens it via a blob: URL, which
 * auto-prints on load.
 *
 * This deliberately does NOT print the live app DOM. An installed/
 * standalone home-screen app can't reach the system print dialog at all —
 * window.print() is a silent no-op there — and window.open() of a
 * same-origin app URL tends to stay trapped inside the installed shell
 * rather than escaping to a real browser window (confirmed: it "flashed"
 * back to the app instead of opening anything). A blob: URL has no origin
 * any PWA manifest can claim, so the OS always treats it as an ordinary
 * document in its own window — this works identically whether the app is
 * installed or just open in a browser tab, so callers never need to
 * special-case standalone mode.
 */
export function printSchedule(participantName: string, subtitle: string, days: PrintDaySection[]) {
  const dayBlocks = days.map((d) => {
    const itemsHtml = d.items.length
      ? d.items.map((i) => {
          const meta = CATEGORY_META[i.category]
          return `<div class="item">
            <div class="time">${escapeHtml(formatTimeRange(i.start_time, i.end_time))}</div>
            <div class="title">${meta.emoji} ${escapeHtml(i.title)}</div>
            <div class="category">${escapeHtml(meta.label)}</div>
            ${i.description ? `<div class="desc">${escapeHtml(i.description)}</div>` : ''}
          </div>`
        }).join('')
      : '<p class="empty">Nothing scheduled.</p>'
    return `<div class="day-heading">${escapeHtml(d.label)}</div>${itemsHtml}`
  }).join('')

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(participantName)}'s schedule</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; margin: 2rem; }
  h1 { font-size: 1.3rem; margin: 0 0 1rem; }
  .day-heading { font-weight: 700; font-size: 1rem; margin: 1.2rem 0 0.5rem; }
  .day-heading:first-of-type { margin-top: 0; }
  .item { border: 1px solid #ccc; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 0.6rem; break-inside: avoid; }
  .item .time { font-weight: 700; font-size: 0.85rem; color: #444; }
  .item .title { font-weight: 700; font-size: 1rem; margin: 0.2rem 0; }
  .item .category { font-size: 0.8rem; color: #666; }
  .item .desc { font-size: 0.9rem; margin-top: 0.4rem; }
  .empty { color: #666; font-size: 0.9rem; }
  @media print { body { margin: 0.5in; } }
</style>
</head>
<body>
<h1>${escapeHtml(participantName)}'s schedule — ${escapeHtml(subtitle)}</h1>
${dayBlocks}
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`

  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) window.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
