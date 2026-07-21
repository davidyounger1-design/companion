import type { PDFFont, PDFPage } from 'pdf-lib'
import { CATEGORY_META, formatTimeRange } from './schedule'
import type { ScheduleItem } from '../types/database'

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return s.replace(/[&<>"']/g, (c) => map[c])
}

export type PrintDaySection = { label: string; items: ScheduleItem[]; note?: string | null }

/** True when running as an installed/home-screen app rather than a regular
 * browser tab. This is the ONLY context where printing actually breaks —
 * iOS gives a standalone app's own window.open() a second app window with
 * no browser chrome at all (no address bar, no share button, no way out
 * except force-quitting — confirmed by testing), so window.print() and the
 * new-window trick both silently fail there. A normal tab, installed or
 * not, has no such restriction. */
function isStandaloneDisplay(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

/** Greedy word-wrap using the font's actual glyph widths — pdf-lib has no
 * built-in text-wrapping helper (unlike jsPDF's splitTextToSize). */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}

/** Truncates with an ellipsis so a long title never runs into the category
 * column — used to keep the time/title/category row to a single line. */
function truncateToWidth(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let end = text.length
  while (end > 0 && font.widthOfTextAtSize(`${text.slice(0, end)}…`, size) > maxWidth) end--
  return `${text.slice(0, end)}…`
}

async function buildSchedulePdf(participantName: string, subtitle: string, days: PrintDaySection[]): Promise<Blob> {
  // Lazy-loaded: pdf-lib only downloads when someone actually taps Print
  // from an installed app, not as part of every page's initial bundle.
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold)

  // Portrait A4 — pdf-lib's own PageSizes.A4 constant is this exact
  // [width, height] pair (width < height = portrait). Rotation is locked
  // explicitly too, in case a printer/driver ignores page dimensions and
  // infers orientation from something else.
  const pageWidth = 595.28
  const pageHeight = 841.89
  const marginX = 48
  const muted = rgb(0.4, 0.4, 0.4)
  const black = rgb(0, 0, 0)

  // Time | title | category on a single row (previously three stacked
  // lines per item) roughly doubles how many items fit per page — the
  // column widths below are sized generously for the longest realistic
  // time-range string and a short category word, giving the title
  // whatever's left; a title that still overflows gets truncated with
  // an ellipsis rather than colliding with the category column.
  const titleX = marginX + 130
  const categoryColWidth = 85
  const categoryX = pageWidth - marginX - categoryColWidth
  const titleMaxWidth = categoryX - titleX - 8
  const descriptionMaxWidth = pageWidth - marginX * 2 - 10

  function newPage(): PDFPage {
    const p = pdf.addPage([pageWidth, pageHeight])
    p.setRotation(degrees(0))
    return p
  }

  let page: PDFPage = newPage()
  let y = pageHeight - 60

  function ensureSpace(needed: number) {
    if (y - needed < 48) {
      page = newPage()
      y = pageHeight - 60
    }
  }
  function draw(text: string, x: number, useFont: PDFFont, size: number, color = black) {
    page.drawText(text, { x, y, size, font: useFont, color })
  }

  draw(`${participantName}'s schedule`, marginX, fontBold, 22)
  y -= 26
  draw(subtitle, marginX, font, 13)
  y -= 24

  for (const day of days) {
    ensureSpace(30)
    draw(day.label, marginX, fontBold, 15)
    y -= 18

    if (day.note) {
      const noteLines = wrapText(day.note, fontBold, 11, pageWidth - marginX * 2 - 24)
      const boxHeight = 16 + (1 + noteLines.length) * 14
      ensureSpace(boxHeight + 12)
      const boxTop = y + 10
      page.drawRectangle({
        x: marginX, y: boxTop - boxHeight, width: pageWidth - marginX * 2, height: boxHeight,
        color: rgb(0.96, 0.88, 0.8), borderColor: rgb(0.75, 0.48, 0.35), borderWidth: 1,
      })
      y -= 4
      draw('NOTE FOR THIS DAY', marginX + 12, fontBold, 8, rgb(0.54, 0.29, 0.19))
      y -= 14
      for (const line of noteLines) {
        draw(line, marginX + 12, fontBold, 11, black)
        y -= 14
      }
      y -= 12
    }

    if (!day.items.length) {
      draw('Nothing scheduled.', marginX, font, 12, muted)
      y -= 20
      continue
    }

    for (const item of day.items) {
      const meta = CATEGORY_META[item.category]
      ensureSpace(item.description ? 34 : 18)
      draw(formatTimeRange(item.start_time, item.end_time), marginX, fontBold, 9)
      draw(truncateToWidth(item.title, fontBold, 11, titleMaxWidth), titleX, fontBold, 11)
      draw(meta.label, categoryX, font, 9, muted)
      y -= 15
      if (item.description) {
        const wrapped = wrapText(item.description, font, 10, descriptionMaxWidth)
        for (const line of wrapped) {
          ensureSpace(13)
          draw(line, marginX + 10, font, 10)
          y -= 13
        }
      }
      y -= 6
    }
    y -= 8
  }

  const bytes = await pdf.save()
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
}

/**
 * Hands the PDF to the native Share Sheet (iOS/Android), which lists
 * "Print" as one of the destinations for a shared PDF file — the one path
 * that actually works from inside an installed app. Returns 'unsupported'
 * when the platform can't share files at all (older iOS, most desktop
 * browsers) so the caller can fall back; a user simply dismissing the
 * share sheet counts as 'shared' — it was invoked correctly either way.
 */
async function shareSchedulePdf(participantName: string, subtitle: string, days: PrintDaySection[]): Promise<'shared' | 'unsupported'> {
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean
    share?: (data: { files: File[]; title?: string }) => Promise<void>
  }
  if (!nav.canShare || !nav.share) return 'unsupported'

  const pdfBlob = await buildSchedulePdf(participantName, subtitle, days)
  const file = new File([pdfBlob], `${participantName.replace(/[^a-z0-9]+/gi, '-')}-schedule.pdf`, { type: 'application/pdf' })
  if (!nav.canShare({ files: [file] })) return 'unsupported'

  try {
    await nav.share({ files: [file], title: `${participantName}'s schedule` })
  } catch {
    // AbortError (dismissed) or similar — the sheet still opened correctly.
  }
  return 'shared'
}

/** Builds a self-contained HTML document (no dependency on the app's own
 * stylesheet/theme) and writes it into a freshly opened window, which
 * auto-prints on load. Reliable in any ordinary browser tab. */
function printHtmlDocument(participantName: string, subtitle: string, days: PrintDaySection[]) {
  const win = window.open('', '_blank')
  if (!win) return // popup blocked — exceedingly rare for a direct click-triggered open

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
    const noteHtml = d.note
      ? `<div class="day-note"><div class="day-note-label">Note for this day</div>${escapeHtml(d.note)}</div>`
      : ''
    return `<div class="day-heading">${escapeHtml(d.label)}</div>${noteHtml}${itemsHtml}`
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
  .day-note { background: #f7ddc4; border: 1.5px solid #c07a5b; border-radius: 8px; padding: 0.65rem 0.9rem; margin-bottom: 0.7rem; font-weight: 700; font-size: 0.95rem; break-inside: avoid; }
  .day-note-label { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #8a4a30; margin-bottom: 0.2rem; }
  @media print { body { margin: 0.5in; } }
</style>
</head>
<body>
<h1>${escapeHtml(participantName)}'s schedule — ${escapeHtml(subtitle)}</h1>
${dayBlocks}
<script>window.onload = function () { window.print(); };</script>
</body>
</html>`

  win.document.open()
  win.document.write(html)
  win.document.close()
}

export async function printSchedule(participantName: string, subtitle: string, days: PrintDaySection[]) {
  if (isStandaloneDisplay()) {
    const result = await shareSchedulePdf(participantName, subtitle, days)
    if (result === 'unsupported') {
      alert("Printing isn't available from the installed app on this device. Open Companion in Safari or Chrome instead, then tap Print again.")
    }
    return
  }
  printHtmlDocument(participantName, subtitle, days)
}
