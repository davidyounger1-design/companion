import { CATEGORY_META, formatTimeRange } from './schedule'
import type { ScheduleItem } from '../types/database'

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return s.replace(/[&<>"']/g, (c) => map[c])
}

export type PrintDaySection = { label: string; items: ScheduleItem[] }

/**
 * Builds a self-contained HTML document (no dependency on the app's own
 * stylesheet, theme, or React tree) and writes it directly into a freshly
 * opened window, which auto-prints on load.
 *
 * This deliberately does NOT print the live app DOM. An installed/
 * standalone home-screen app can't reach the system print dialog at all —
 * window.print() is a silent no-op there — and window.open() of a
 * same-origin app URL tends to stay trapped inside the installed shell
 * rather than escaping to a real browser window (confirmed: it "flashed"
 * back to the app instead of opening anything).
 *
 * Opening the window FIRST with a blank/synchronous window.open('', '_blank')
 * — before building any content — still escapes an installed shell the same
 * way a plain link tap does, but avoids blob: URLs entirely: iOS Safari is
 * well known for failing to render a blob: URL opened in a new tab/window,
 * even though the popup itself opens (this is exactly what silently failed
 * the first attempt at this). document.write() into that window works
 * reliably everywhere blob: doesn't.
 */
export function printSchedule(participantName: string, subtitle: string, days: PrintDaySection[]) {
  // Open synchronously, in direct response to the click, before any other
  // work — this is what lets it count as a user-initiated popup rather
  // than getting blocked.
  const win = window.open('', '_blank')

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

  if (!win) return // popup blocked — exceedingly rare for a direct click-triggered open
  win.document.open()
  win.document.write(html)
  win.document.close()
}
