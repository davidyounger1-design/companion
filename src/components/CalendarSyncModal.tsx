import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useModalOpen } from '../context/ModalActivityContext'
import type { CalendarFeed } from '../types/database'

// Must match the check constraint in 097_calendar_feeds.sql and the zones the
// calendar-feed edge function carries VTIMEZONE definitions for.
const TIMEZONES = [
  { value: 'Australia/Sydney', label: 'Sydney (NSW / ACT)' },
  { value: 'Australia/Melbourne', label: 'Melbourne (Victoria)' },
  { value: 'Australia/Brisbane', label: 'Brisbane (Queensland)' },
  { value: 'Australia/Adelaide', label: 'Adelaide (South Australia)' },
  { value: 'Australia/Perth', label: 'Perth (Western Australia)' },
  { value: 'Australia/Darwin', label: 'Darwin (Northern Territory)' },
  { value: 'Australia/Hobart', label: 'Hobart (Tasmania)' },
]

const REMINDERS: { value: string; label: string }[] = [
  { value: '', label: 'No reminder' },
  { value: '0', label: 'At the start' },
  { value: '5', label: '5 minutes before' },
  { value: '10', label: '10 minutes before' },
  { value: '15', label: '15 minutes before' },
  { value: '30', label: '30 minutes before' },
  { value: '60', label: '1 hour before' },
]

function defaultTimezone() {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  return TIMEZONES.some((t) => t.value === local) ? local : 'Australia/Sydney'
}

/** 64 hex chars (256 bits) — the same shape the column default generates. */
function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function feedUrl(token: string) {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-feed/${token}.ics`
}

/** Bottom sheet for the schedule page's "Calendar" button: creates, shows,
 * configures and revokes the participant's private calendar-subscription link
 * (served by the calendar-feed edge function). One-way: calendar apps read
 * the schedule, nothing flows back. */
export default function CalendarSyncModal({
  clientId, orgId, userId, participantName, onClose,
}: {
  clientId: string
  orgId: string
  userId: string
  participantName: string
  onClose: () => void
}) {
  useModalOpen()
  const qc = useQueryClient()
  const queryKey = ['calendar-feed', clientId]

  const { data: feed, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from('calendar_feeds').select('*').eq('client_id', clientId).maybeSingle()
      if (error) throw error
      return data as CalendarFeed | null
    },
  })

  const [timezone, setTimezone] = useState(defaultTimezone)
  const [reminder, setReminder] = useState('10')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function run(fn: () => Promise<{ error: { message: string } | null }>) {
    setBusy(true)
    setError(null)
    const { error: err } = await fn()
    setBusy(false)
    if (err) setError(err.message)
    else qc.invalidateQueries({ queryKey })
  }

  const create = () => run(async () => supabase.from('calendar_feeds').insert({
    client_id: clientId, org_id: orgId, created_by: userId, token: newToken(),
    timezone, reminder_minutes: reminder === '' ? null : Number(reminder),
  }))

  const update = (patch: { timezone?: string; reminder_minutes?: number | null }) => run(async () =>
    supabase.from('calendar_feeds').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', feed!.id))

  const regenerate = () => {
    if (!confirm('Generate a new link? The current link stops working — anything already subscribed to it will need the new one.')) return
    return run(async () => supabase.from('calendar_feeds')
      .update({ token: newToken(), updated_at: new Date().toISOString() }).eq('id', feed!.id))
  }

  const stop = () => {
    if (!confirm(`Stop sharing ${participantName}'s schedule to calendars? Anything already subscribed will stop updating.`)) return
    return run(async () => supabase.from('calendar_feeds').delete().eq('id', feed!.id))
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy automatically — press and hold the link to copy it.')
    }
  }

  const url = feed ? feedUrl(feed.token) : ''
  const small = { fontSize: '0.8rem', color: 'var(--color-muted)', lineHeight: 1.5 } as const

  return (
    <>
      <div onClick={onClose} className="sheet-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'rgba(0,0,0,0.4)' }} />
      <div className="sheet-panel" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        background: 'var(--color-surface)', borderRadius: '20px 20px 0 0',
        boxShadow: 'var(--shadow-lg)', maxWidth: 480, margin: '0 auto',
        maxHeight: '90dvh', overflowY: 'auto',
        padding: '1rem 1.25rem calc(1rem + env(safe-area-inset-bottom))',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
        </div>
        <p style={{ margin: '0 0 0.25rem', fontWeight: 700, fontSize: '1.05rem' }}>📅 Sync to calendar</p>
        <p style={{ ...small, margin: '0 0 1rem' }}>
          Show {participantName}'s schedule in an iPhone, iCloud or Google calendar. Changes made in Companion
          appear in the calendar automatically. It works one way — changes made inside the calendar app don't come back.
        </p>

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem' }}>
            <div className="spinner" style={{ color: 'var(--color-primary)' }} />
          </div>
        ) : !feed ? (
          <>
            <div className="field" style={{ marginBottom: '0.75rem' }}>
              <label>Timezone</label>
              <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: '1rem' }}>
              <label>Reminder</label>
              <select className="input" value={reminder} onChange={(e) => setReminder(e.target.value)}>
                {REMINDERS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <button className="btn btn-primary btn-full" onClick={create} disabled={busy}>
              {busy ? <span className="spinner" /> : 'Create calendar link'}
            </button>
          </>
        ) : (
          <>
            <a className="btn btn-primary btn-full" href={url.replace(/^https?:\/\//, 'webcal://')}
              style={{ textAlign: 'center', textDecoration: 'none', marginBottom: '0.5rem' }}>
              📱 Add to iPhone / iCloud calendar
            </a>
            <p style={{ ...small, margin: '0 0 0.75rem' }}>
              Open this on the iPhone itself and tap Subscribe. Not on the iPhone? Copy the link and send it there.
            </p>

            <div className="field" style={{ marginBottom: '0.5rem' }}>
              <label>Calendar link</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0 }} />
                <button className="btn btn-secondary" onClick={() => copy(url)}>{copied ? 'Copied ✓' : 'Copy'}</button>
              </div>
            </div>
            <p style={{ ...small, margin: '0 0 1rem' }}>
              <strong>Google Calendar:</strong> on a computer, open Google Calendar → Other calendars (+) → From URL, and paste the link.
              iPhone refreshes roughly hourly; Google can take up to a day.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1rem' }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Timezone</label>
                <select className="input" value={feed.timezone} disabled={busy} onChange={(e) => update({ timezone: e.target.value })}>
                  {TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Reminder</label>
                <select className="input" value={feed.reminder_minutes == null ? '' : String(feed.reminder_minutes)} disabled={busy}
                  onChange={(e) => update({ reminder_minutes: e.target.value === '' ? null : Number(e.target.value) })}>
                  {REMINDERS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
            </div>

            <p style={{ ...small, margin: '0 0 0.75rem' }}>
              🔒 Anyone with this link can see {participantName}'s schedule — only share it with people who should.
            </p>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button className="btn btn-ghost" onClick={regenerate} disabled={busy} style={{ flex: 1, fontSize: '0.82rem' }}>Generate new link</button>
              <button className="btn btn-ghost" onClick={stop} disabled={busy}
                style={{ flex: 1, fontSize: '0.82rem', color: 'var(--color-error)' }}>Stop sharing</button>
            </div>
          </>
        )}

        {error && <p style={{ margin: '0.75rem 0 0', fontSize: '0.82rem', color: 'var(--color-error)' }}>{error}</p>}

        <button className="btn btn-ghost btn-full" onClick={onClose} style={{ marginTop: '0.75rem' }}>Close</button>
      </div>
    </>
  )
}
