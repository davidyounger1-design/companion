// Serves a participant's schedule as a subscribable iCalendar (.ics) feed, so
// iPhone Calendar / Google Calendar / Outlook can subscribe once and stay in
// step with Companion. One-way only: calendar apps read the feed, nothing is
// written back.
//
//   GET /functions/v1/calendar-feed/<token>.ics     (or ?token=<token>)
//
// Auth is the token itself (companion.calendar_feeds.token, 64 hex chars) —
// a calendar app can't send a login header, so the link is the secret. It is
// revocable/regenerable from the schedule page. Deploy with Verify JWT OFF
// (see [functions.calendar-feed] in config.toml).
//
// Deliberately NOT the usual "always HTTP 200 + { ok }" convention the other
// functions follow: that exists so supabase.functions.invoke() can read error
// bodies, but this is consumed by calendar clients, which would treat a 200
// JSON body as a corrupt calendar. Real status codes are correct here — a
// calendar app keeps showing its last good copy when a refresh fails.
//
// Single file by design (the dashboard editor doesn't bundle ../_shared), so
// the iCalendar builder is inlined below. Everything above the `Deno.serve`
// line is pure, so it can be unit-tested without a Deno runtime.
import { createClient } from 'jsr:@supabase/supabase-js@2'

// ── iCalendar building ───────────────────────────────────────────────

export type FeedItem = {
  id: string
  title: string
  description: string | null
  category: string
  start_time: string            // 'HH:MM:SS'
  end_time: string | null
  recurrence: 'once' | 'weekly'
  specific_date: string | null  // 'YYYY-MM-DD' for 'once'
  days_of_week: number[] | null // 0=Sun..6=Sat for 'weekly'
  url: string | null
  created_at: string
}
export type FeedSkip = { schedule_item_id: string; occurrence_date: string }
export type FeedDayNote = { id: string; note_date: string; body: string }
export type FeedInput = {
  participantName: string
  timezone: string
  reminderMinutes: number | null
  items: FeedItem[]
  skips: FeedSkip[]
  dayNotes: FeedDayNote[]
  now: Date
}

const UID_DOMAIN = 'companion.myappbuddy.com.au'
const DEFAULT_DURATION_MIN = 30

const CATEGORY_LABEL: Record<string, string> = {
  therapy: 'Therapy', meal: 'Meal', activity: 'Activity', personal_care: 'Personal care',
  social: 'Social', appointment: 'Appointment', transport: 'Transport', other: 'Other',
}

// Australian zones only (matches the check constraint in 097_calendar_feeds.sql).
// Rules since 2008: DST starts first Sunday in October, ends first Sunday in April.
type TzDef = { std: [string, string]; dst?: [string, string] } // [name, '+HHMM']
const AEST_AEDT: TzDef = { std: ['AEST', '+1000'], dst: ['AEDT', '+1100'] }
const TIMEZONES: Record<string, TzDef> = {
  'Australia/Sydney': AEST_AEDT,
  'Australia/Melbourne': AEST_AEDT,
  'Australia/Hobart': AEST_AEDT,
  'Australia/Adelaide': { std: ['ACST', '+0930'], dst: ['ACDT', '+1030'] },
  'Australia/Brisbane': { std: ['AEST', '+1000'] },
  'Australia/Darwin': { std: ['ACST', '+0930'] },
  'Australia/Perth': { std: ['AWST', '+0800'] },
}
export const DEFAULT_TIMEZONE = 'Australia/Sydney'

function vtimezone(tzid: string): string[] {
  const def = TIMEZONES[tzid] ?? TIMEZONES[DEFAULT_TIMEZONE]
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tzid}`]
  if (def.dst) {
    lines.push(
      'BEGIN:DAYLIGHT',
      `TZOFFSETFROM:${def.std[1]}`, `TZOFFSETTO:${def.dst[1]}`, `TZNAME:${def.dst[0]}`,
      'DTSTART:19701004T020000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      `TZOFFSETFROM:${def.dst[1]}`, `TZOFFSETTO:${def.std[1]}`, `TZNAME:${def.std[0]}`,
      'DTSTART:19700405T030000', 'RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU',
      'END:STANDARD',
    )
  } else {
    lines.push(
      'BEGIN:STANDARD',
      `TZOFFSETFROM:${def.std[1]}`, `TZOFFSETTO:${def.std[1]}`, `TZNAME:${def.std[0]}`,
      'DTSTART:19700101T000000',
      'END:STANDARD',
    )
  }
  lines.push('END:VTIMEZONE')
  return lines
}

/** RFC 5545 TEXT escaping. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
}

/** Folds a content line to ≤75 octets per physical line, never splitting a UTF-8 character. */
export function fold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let curBytes = 0
  let limit = 75
  for (const ch of line) {
    const b = enc.encode(ch).length
    if (curBytes + b > limit) {
      out.push(cur)
      cur = ''
      curBytes = 0
      limit = 74 // continuation lines start with a space
    }
    cur += ch
    curBytes += b
  }
  out.push(cur)
  return out.join('\r\n ')
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
const ymd = (d: string) => d.replace(/-/g, '')
const hms = (t: string) => {
  const [h, m, s] = t.split(':')
  return `${pad(Number(h))}${pad(Number(m))}${pad(Number(s ?? 0))}`
}
const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Naive (zone-less) local date + minutes-after-midnight arithmetic. */
function addMinutes(date: string, minutes: number): { date: string; minutes: number } {
  const [y, mo, d] = date.split('-').map(Number)
  const t = Date.UTC(y, mo - 1, d) + minutes * 60_000
  const dt = new Date(t)
  return {
    date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    minutes: dt.getUTCHours() * 60 + dt.getUTCMinutes(),
  }
}
const stamp = (date: string, minutes: number) =>
  `${ymd(date)}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`

function dowOf(date: string): number {
  const [y, mo, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
}

/** Local calendar date ('YYYY-MM-DD') of an instant in the given zone. */
function localDate(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

export function buildIcs(input: FeedInput): string {
  const tz = TIMEZONES[input.timezone] ? input.timezone : DEFAULT_TIMEZONE
  const dtstamp = utcStamp(input.now)
  const skipsByItem = new Map<string, string[]>()
  for (const s of input.skips) {
    const arr = skipsByItem.get(s.schedule_item_id) ?? []
    arr.push(s.occurrence_date)
    skipsByItem.set(s.schedule_item_id, arr)
  }

  const L: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MyAppBuddy//Companion//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${input.participantName}'s schedule`)}`,
    `X-WR-TIMEZONE:${tz}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...vtimezone(tz),
  ]

  for (const item of input.items) {
    const startMin = toMinutes(item.start_time)
    let duration = DEFAULT_DURATION_MIN
    if (item.end_time) {
      const endMin = toMinutes(item.end_time)
      duration = endMin > startMin ? endMin - startMin : endMin + 1440 - startMin // overnight
      if (duration === 0) duration = DEFAULT_DURATION_MIN
    }

    let startDate: string
    let rrule: string | null = null
    let exdate: string | null = null

    if (item.recurrence === 'once') {
      if (!item.specific_date) continue
      startDate = item.specific_date
    } else {
      const days = (item.days_of_week ?? []).filter((d) => d >= 0 && d <= 6)
      if (!days.length) continue
      // First matching weekday on/after the day the item was created.
      let d = localDate(new Date(item.created_at), tz)
      for (let i = 0; i < 7 && !days.includes(dowOf(d)); i++) d = addMinutes(d, 1440).date
      startDate = d
      rrule = `FREQ=WEEKLY;BYDAY=${[...days].sort().map((n) => BYDAY[n]).join(',')}`
      const skipped = (skipsByItem.get(item.id) ?? []).filter((s) => s >= startDate)
      if (skipped.length) {
        exdate = skipped.map((s) => `${ymd(s)}T${hms(item.start_time)}`).join(',')
      }
    }

    const end = addMinutes(startDate, startMin + duration)
    L.push(
      'BEGIN:VEVENT',
      `UID:${item.id}@${UID_DOMAIN}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${tz}:${stamp(startDate, startMin)}`,
      `DTEND;TZID=${tz}:${stamp(end.date, end.minutes)}`,
    )
    if (rrule) L.push(`RRULE:${rrule}`)
    if (exdate) L.push(`EXDATE;TZID=${tz}:${exdate}`)
    L.push(`SUMMARY:${esc(item.title)}`)
    if (item.description) L.push(`DESCRIPTION:${esc(item.description)}`)
    L.push(`CATEGORIES:${esc(CATEGORY_LABEL[item.category] ?? 'Other')}`)
    // The app stores bare domains ("google.com") as typed; calendar apps need a scheme.
    const link = item.url?.trim()
    if (link && !/\s/.test(link)) L.push(`URL:${/^https?:\/\//i.test(link) ? link : `https://${link}`}`)
    if (input.reminderMinutes != null) {
      L.push(
        'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(item.title)}`,
        input.reminderMinutes === 0 ? 'TRIGGER:PT0S' : `TRIGGER:-PT${input.reminderMinutes}M`,
        'END:VALARM',
      )
    }
    L.push('END:VEVENT')
  }

  // Day notes ("Grandma's visiting today") as all-day, non-blocking events.
  for (const n of input.dayNotes) {
    const firstLine = n.body.split(/\r?\n/)[0].trim()
    const summary = firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine
    L.push(
      'BEGIN:VEVENT',
      `UID:daynote-${n.id}@${UID_DOMAIN}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${ymd(n.note_date)}`,
      `DTEND;VALUE=DATE:${ymd(addMinutes(n.note_date, 1440).date)}`,
      `SUMMARY:${esc(`📝 ${summary}`)}`,
      `DESCRIPTION:${esc(n.body)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }

  L.push('END:VCALENDAR')
  return L.map(fold).join('\r\n') + '\r\n'
}

// ── HTTP handler ─────────────────────────────────────────────────────

const TOKEN_RE = /^[a-f0-9]{64}$/
const plain = (status: number, body: string) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

Deno.serve(async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return plain(405, 'Method not allowed')

  const url = new URL(req.url)
  const lastSegment = url.pathname.split('/').filter(Boolean).pop() ?? ''
  const fromPath = lastSegment === 'calendar-feed' ? '' : lastSegment.replace(/\.ics$/i, '')
  const token = (url.searchParams.get('token') ?? fromPath).toLowerCase()
  // Same answer for malformed and unknown tokens — nothing to enumerate.
  if (!TOKEN_RE.test(token)) return plain(404, 'Calendar not found')

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'companion' } },
  )

  const { data: feed, error: feedErr } = await supabase
    .from('calendar_feeds')
    .select('client_id, timezone, reminder_minutes')
    .eq('token', token)
    .maybeSingle()
  if (feedErr) return plain(500, 'Could not load calendar')
  if (!feed) return plain(404, 'Calendar not found')

  const now = new Date()
  const tz = TIMEZONES[feed.timezone] ? feed.timezone : DEFAULT_TIMEZONE
  const notesFrom = addMinutes(localDate(now, tz), -7 * 1440).date // a week back, then everything ahead

  const [client, items, skips, notes] = await Promise.all([
    supabase.from('clients').select('full_name').eq('id', feed.client_id).maybeSingle(),
    supabase.from('schedule_items')
      .select('id, title, description, category, start_time, end_time, recurrence, specific_date, days_of_week, url, created_at')
      .eq('client_id', feed.client_id).eq('active', true),
    supabase.from('schedule_item_skips').select('schedule_item_id, occurrence_date').eq('client_id', feed.client_id),
    supabase.from('day_notes').select('id, note_date, body').eq('client_id', feed.client_id).gte('note_date', notesFrom),
  ])
  if (client.error || items.error || skips.error || notes.error) return plain(500, 'Could not load calendar')

  const ics = buildIcs({
    participantName: client.data?.full_name ?? 'Participant',
    timezone: tz,
    reminderMinutes: feed.reminder_minutes,
    items: (items.data ?? []) as FeedItem[],
    skips: (skips.data ?? []) as FeedSkip[],
    dayNotes: (notes.data ?? []) as FeedDayNote[],
    now,
  })

  return new Response(req.method === 'HEAD' ? null : ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="schedule.ics"',
      // The link is a bearer secret — keep it out of shared caches.
      'Cache-Control': 'private, no-cache',
    },
  })
})
