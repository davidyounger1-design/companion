import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import type { LogEntry } from '../../types/database'
import Lightbox from '../../components/Lightbox'
import { MoodBar, moodColor, moodEmoji } from '../../components/MoodSlider'
import FamilyBottomNav from '../../components/FamilyBottomNav'
import ScheduleStatusBar from '../../components/ScheduleStatusBar'
import EntryComments from '../../components/EntryComments'
import EntryReactions from '../../components/EntryReactions'
import ClientFeedback from '../../components/ClientFeedback'
import { MobileFooter } from '../../components/SiteFooter'
import type { LogType } from '../../types/database'
import { useInstallPrompt } from '../../hooks/useInstallPrompt'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import { usePhotoKey } from '../../hooks/usePhotoKey'
import { decryptToObjectURL, mimeFromPath } from '../../lib/photoEncryption'
import { EditIcon, TrashIcon, NoticesIcon } from '../../components/icons'
import { useTimerTheme } from '../../hooks/useTimerTheme'
import { themedPageBackground } from '../../lib/timer'


function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

const RETENTION_DAYS = 30

function daysUntilExpiry(occurredAt: string): number {
  const elapsed = Math.floor((Date.now() - new Date(occurredAt).getTime()) / 86_400_000)
  return RETENTION_DAYS - elapsed
}

function ExpiryChip({ daysLeft }: { daysLeft: number }) {
  if (daysLeft <= 0) {
    return <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 700, letterSpacing: '0.01em' }}>Expires today</span>
  }
  if (daysLeft === 1) {
    return <span style={{ fontSize: '0.68rem', color: '#ef4444', fontWeight: 700 }}>1 day left</span>
  }
  if (daysLeft <= 7) {
    return <span style={{ fontSize: '0.68rem', color: '#d97706', fontWeight: 600 }}>{daysLeft} days left</span>
  }
  if (daysLeft <= 14) {
    return <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)' }}>{daysLeft} days left</span>
  }
  return <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)', opacity: 0.7 }}>{daysLeft}d</span>
}

const TYPE_ICON: Record<string, string> = {
  meal: '🍽️', activity: '🌿', mood: '😊', note: '📝', photo: '📷',
}

const LOG_TYPES: { type: LogType; icon: string; label: string }[] = [
  { type: 'meal', icon: '🍽️', label: 'Meal' },
  { type: 'activity', icon: '🌿', label: 'Activity' },
  { type: 'mood', icon: '😊', label: 'Mood' },
  { type: 'note', icon: '📝', label: 'Note' },
]

function isVideoPath(path: string) {
  return /\.(mp4|mov|webm|m4v|avi|ogv)(\?|$)/i.test(path)
}

function MediaEntry({ path, canShare, shareText }: { path: string; canShare: boolean; shareText?: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const [lightbox, setLightbox] = useState(false)
  const { data: keyHex } = usePhotoKey()
  const isVid = isVideoPath(path)

  const { data: signedUrl } = useQuery({
    queryKey: ['media-url', path],
    queryFn: async () => {
      const { data } = await supabase.storage.from('journal-photos').createSignedUrl(path, 900)
      return data?.signedUrl ?? null
    },
    staleTime: 840_000,
  })

  useEffect(() => {
    if (!signedUrl || !keyHex) return
    let active = true
    ;(async () => {
      try {
        const res = await fetch(signedUrl)
        const buf = await res.arrayBuffer()
        if (!active) return
        const url = await decryptToObjectURL(buf, keyHex, mimeFromPath(path))
        if (!active) { URL.revokeObjectURL(url); return }
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = url
        setObjectUrl(url)
      } catch (err) {
        if (active) console.warn('Photo decrypt error:', err)
      }
    })()
    return () => { active = false }
  }, [signedUrl, keyHex, path])

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
  }, [])

  if (!objectUrl) return (
    <div style={{ width: '100%', height: 160, borderRadius: 8, marginTop: '0.75rem',
      background: 'var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
      <span className="spinner" style={{ width: 24, height: 24 }} />
    </div>
  )

  return (
    <>
      {isVid ? (
        <video src={objectUrl} controls style={{ width: '100%', borderRadius: 8, marginTop: '0.75rem', maxHeight: 320, display: 'block' }} />
      ) : (
        <img src={objectUrl} alt="" onClick={() => setLightbox(true)}
          style={{ width: '100%', borderRadius: 8, marginTop: '0.75rem', maxHeight: 320, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
      )}
      {lightbox && <Lightbox src={objectUrl} video={isVid} canShare={canShare} shareText={shareText} onClose={() => setLightbox(false)} />}
    </>
  )
}

type EntryWithAuthor = LogEntry & { author_name?: string }

function EntryCard({
  entry, showAuthor, canEdit, canShare, canDeleteOwn, now, expiryDays, onEdit, onDelete,
}: {
  entry: EntryWithAuthor
  showAuthor: boolean
  canEdit: boolean
  canShare: boolean
  canDeleteOwn: boolean
  now: number
  expiryDays?: number
  onEdit: (e: EntryWithAuthor) => void
  onDelete: (id: string) => void
}) {
  const [confirmDel, setConfirmDel] = useState(false)
  const secondsLeft = canDeleteOwn
    ? Math.max(0, 60 - Math.floor((now - new Date(entry.created_at).getTime()) / 1000))
    : 0

  useEffect(() => { if (!canDeleteOwn) setConfirmDel(false) }, [canDeleteOwn])

  const shareText = entry.label !== '📷' && entry.label !== '🎥' ? entry.label : undefined
  return (
    <div className="card" style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flex: 1 }}>
          <span style={{ fontSize: '1.1rem', marginTop: 2 }}>{TYPE_ICON[entry.type] ?? '📝'}</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.5 }}>{entry.label}</p>
            {showAuthor && entry.author_name && (
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>{entry.author_name}</p>
            )}
            <MoodBar score={entry.mood_score} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: '0.75rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', whiteSpace: 'nowrap' }}>{formatTime(entry.occurred_at)}</span>
          {canDeleteOwn && !confirmDel && (
            <button onClick={() => setConfirmDel(true)} title={`Delete (${secondsLeft}s)`}
              className="icon-btn icon-btn-danger" style={{ width: 26, height: 26 }}><TrashIcon size={13} /></button>
          )}
          {canDeleteOwn && confirmDel && (
            <button onClick={() => onDelete(entry.id)}
              style={{ background: '#ef4444', color: '#fff', border: 'none', borderRadius: 6, padding: '0.15rem 0.4rem', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 600, lineHeight: 1.4 }}>
              Delete?
            </button>
          )}
          {canEdit && !confirmDel && (
            <button onClick={() => onEdit(entry)} title="Edit entry"
              className="icon-btn" style={{ width: 26, height: 26 }}><EditIcon size={13} /></button>
          )}
        </div>
      </div>
      {entry.photo_path && <MediaEntry path={entry.photo_path} canShare={canShare} shareText={shareText} />}
      {expiryDays !== undefined && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.3rem' }}>
          <ExpiryChip daysLeft={expiryDays} />
        </div>
      )}
      <EntryReactions entryId={entry.id} />
      <EntryComments entryId={entry.id} clientId={entry.client_id} orgId={entry.org_id} />
    </div>
  )
}

function EditEntryModal({
  entry, canDelete, onSave, onDelete, onClose,
}: {
  entry: EntryWithAuthor
  canDelete: boolean
  onSave: (id: string, label: string, type: LogType, moodScore: number) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}) {
  const [editLabel, setEditLabel] = useState(entry.label === '📷' || entry.label === '🎥' ? '' : entry.label)
  const [editType, setEditType] = useState<LogType>((LOG_TYPES.find(t => t.type === entry.type)?.type ?? 'note') as LogType)
  const [editMood, setEditMood] = useState(entry.mood_score ?? 50)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    try { await onSave(entry.id, editLabel, editType, editMood) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); setSaving(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    try { await onDelete(entry.id) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not delete.'); setDeleting(false); setConfirmDelete(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <p style={{ fontWeight: 600, marginBottom: '1rem' }}>Edit entry</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
          {LOG_TYPES.map(({ type, icon, label }) => (
            <button key={type} type="button"
              className={`log-type-btn${editType === type ? ' selected' : ''}`}
              onClick={() => setEditType(type)}>
              <span className="icon">{icon}</span>{label}
            </button>
          ))}
        </div>

        <div className="field" style={{ marginBottom: '0.75rem' }}>
          <textarea className="input" rows={3} value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)} autoFocus style={{ resize: 'vertical' }} />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
            <label style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Mood rating</label>
            <span>{moodEmoji(editMood)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span>😔</span>
            <input type="range" min={0} max={100} value={editMood}
              onChange={(e) => setEditMood(+e.target.value)}
              style={{ flex: 1, accentColor: moodColor(editMood) }} />
            <span>😊</span>
          </div>
        </div>

        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</div>}

        {confirmDelete ? (
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)} style={{ flex: 1 }}>Keep it</button>
            <button onClick={handleDelete} disabled={deleting}
              style={{ flex: 2, background: '#dc2626', color: '#fff', border: 'none', borderRadius: 'var(--radius)', padding: '0.6rem', fontWeight: 600, cursor: 'pointer', fontSize: '0.9rem' }}>
              {deleting ? <span className="spinner" /> : 'Yes, delete'}
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {canDelete && (
              <button onClick={() => setConfirmDelete(true)}
                style={{ background: 'none', border: '1px solid #fca5a5', color: '#dc2626', borderRadius: 'var(--radius)', padding: '0.6rem 0.75rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500 }}>
                Delete
              </button>
            )}
            <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}
              disabled={saving || (!editLabel.trim() && !entry.photo_path)} style={{ flex: 2 }}>
              {saving ? <span className="spinner" /> : 'Save changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// Collapsible SVG mood chart — tap the header row to expand/collapse
function MoodChart({ entries }: { entries: Array<{ occurred_at: string; mood_score: number | null }> }) {
  const [expanded, setExpanded] = useState(false)

  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (13 - i))
    return d.toISOString().split('T')[0]
  })

  const byDay: Record<string, number[]> = {}
  for (const e of entries) {
    if (e.mood_score == null) continue
    const day = e.occurred_at.split('T')[0]
    if (!byDay[day]) byDay[day] = []
    byDay[day].push(e.mood_score)
  }

  const points = last14.map(d => {
    const scores = byDay[d]
    return scores?.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  })

  const filled = points.filter((p) => p !== null) as number[]
  if (filled.length === 0) return null
  const avg = Math.round(filled.reduce((a, b) => a + b, 0) / filled.length)

  const W = 280, H = 64, PAD = 8
  const xStep = (W - PAD * 2) / 13
  const yScale = (v: number) => H - PAD - ((v / 100) * (H - PAD * 2))

  const linePts = points
    .map((p, i) => p !== null ? `${PAD + i * xStep},${yScale(p)}` : null)
    .filter(Boolean)

  const pathD = linePts.reduce((acc, pt, i) => acc + (i === 0 ? `M ${pt}` : ` L ${pt}`), '')

  return (
    <div style={{ marginTop: '0.75rem', marginBottom: '0.25rem' }}>
      <button
        onClick={() => setExpanded(x => !x)}
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          width: '100%', background: 'none', border: 'none', padding: '0.3rem 0',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '0.78rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)' }}>
          Mood · 14 days
        </span>
        <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          avg {moodEmoji(avg)} {avg}/100
          <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>{expanded ? '▲' : '▼'}</span>
        </span>
      </button>

      {expanded && (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible', marginTop: '0.25rem' }}>
            <line x1={PAD} y1={yScale(avg)} x2={W - PAD} y2={yScale(avg)}
              stroke="var(--color-border)" strokeWidth={1} strokeDasharray="4 3" />
            {pathD && <path d={pathD} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
            {points.map((p, i) => p !== null ? (
              <circle key={i} cx={PAD + i * xStep} cy={yScale(p)} r={3}
                fill={moodColor(p)} stroke="#fff" strokeWidth={1.5} />
            ) : null)}
          </svg>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.15rem' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--color-muted)' }}>14 days ago</span>
            <span style={{ fontSize: '0.6rem', color: 'var(--color-muted)' }}>Today</span>
          </div>
        </>
      )}
    </div>
  )
}

function groupByDate(entries: EntryWithAuthor[]) {
  const groups: Record<string, EntryWithAuthor[]> = {}
  for (const e of entries) {
    const label = formatDate(e.occurred_at)
    if (!groups[label]) groups[label] = []
    groups[label].push(e)
  }
  return Object.entries(groups)
}

function toLocalDate(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function CalendarSheet({
  entries, selectedDate, onSelect, onClose,
}: {
  entries: EntryWithAuthor[]
  selectedDate: string | null
  onSelect: (date: string | null) => void
  onClose: () => void
}) {
  const today = new Date()
  const [viewYear, setViewYear] = useState(
    selectedDate ? +selectedDate.slice(0, 4) : today.getFullYear()
  )
  const [viewMonth, setViewMonth] = useState(
    selectedDate ? +selectedDate.slice(5, 7) - 1 : today.getMonth()
  )

  const entryDates = new Set(entries.map(e => toLocalDate(e.occurred_at)))
  const firstDay = new Date(viewYear, viewMonth, 1)
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const startDow = firstDay.getDay()
  const monthLabel = firstDay.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })
  const todayStr = toLocalDate(today.toISOString())

  function pad(n: number) { return String(n).padStart(2, '0') }
  function iso(d: number) { return `${viewYear}-${pad(viewMonth + 1)}-${pad(d)}` }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const cells: (number | null)[] = []
  for (let i = 0; i < startDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, zIndex: 49,
        background: 'rgba(0,0,0,0.4)',
      }} />
      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
        background: 'var(--color-surface)',
        borderRadius: '20px 20px 0 0',
        padding: '0.75rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
        maxWidth: 520, margin: '0 auto',
      }}>
        {/* drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.875rem' }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
        </div>

        {/* month navigation */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <button className="btn btn-ghost" onClick={prevMonth} style={{ padding: '0.3rem 0.75rem' }}>←</button>
          <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>{monthLabel}</span>
          <button className="btn btn-ghost" onClick={nextMonth} style={{ padding: '0.3rem 0.75rem' }}>→</button>
        </div>

        {/* day-of-week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-muted)', padding: '2px 0' }}>{d}</div>
          ))}
        </div>

        {/* calendar grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
          {cells.map((day, i) => {
            if (!day) return <div key={i} />
            const dateStr = iso(day)
            const hasEntries = entryDates.has(dateStr)
            const isSelected = selectedDate === dateStr
            const isToday = dateStr === todayStr
            return (
              <button
                key={i}
                disabled={!hasEntries}
                onClick={() => { onSelect(isSelected ? null : dateStr); onClose() }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '0.45rem 0',
                  borderRadius: 10,
                  border: isToday && !isSelected ? '1.5px solid var(--color-primary)' : '1.5px solid transparent',
                  background: isSelected ? 'var(--color-primary)' : 'transparent',
                  cursor: hasEntries ? 'pointer' : 'default',
                  opacity: hasEntries ? 1 : 0.3,
                }}
              >
                <span style={{
                  fontSize: '0.875rem',
                  fontWeight: isSelected || isToday ? 700 : 400,
                  color: isSelected ? '#fff' : isToday ? 'var(--color-primary)' : 'var(--color-text)',
                  lineHeight: 1.3,
                }}>
                  {day}
                </span>
                <div style={{
                  width: 5, height: 5, borderRadius: '50%', marginTop: 2,
                  background: isSelected ? 'rgba(255,255,255,0.6)' : hasEntries ? 'var(--color-primary)' : 'transparent',
                }} />
              </button>
            )
          })}
        </div>

        {selectedDate && (
          <button className="btn btn-ghost" onClick={() => { onSelect(null); onClose() }}
            style={{ width: '100%', marginTop: '1rem', fontSize: '0.875rem' }}>
            Show all entries
          </button>
        )}
      </div>
    </>
  )
}



export default function FamilyDashboard() {
  const navigate = useNavigate()
  const { user, profile, org } = useAuth()
  const qc = useQueryClient()
  const { theme } = useTimerTheme()

  const isFamilyPlan = org?.plan === 'family'
  const isCoordinator = profile?.role === 'coordinator'
  const isFamily = profile?.role === 'family'
  const isRecipient = profile?.role === 'recipient'
  const canShare = isCoordinator || isFamily || isRecipient

  const { canInstall, isIOS, install } = useInstallPrompt()
  const { permission: pushPermission, subscribing, subscribe, notifyOnEntry, setNotifyOnEntry } = usePushNotifications()
  const [showIOSTip, setShowIOSTip] = useState(false)
  const [pushDismissed, setPushDismissed] = useState(
    () => localStorage.getItem('push_dismissed') === '1'
  )

  const [editingEntry, setEditingEntry] = useState<EntryWithAuthor | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDob, setEditDob] = useState('')
  const [saving, setSaving] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [now, setNow] = useState(Date.now())

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  const { data: clientRow } = useQuery({
    queryKey: ['family-client', user?.id, profile?.role],
    queryFn: async () => {
      if (profile?.role === 'recipient') {
        const { data } = await supabase
          .from('clients')
          .select('id, full_name, dob')
          .eq('recipient_profile_id', user!.id)
          .maybeSingle()
        return data ? { client_id: data.id, clients: { full_name: data.full_name, dob: data.dob } } : null
      }
      const { data } = await supabase
        .from('client_family')
        .select('client_id, clients(full_name, dob)')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return data
    },
    enabled: !!user && !!profile,
  })

  const clientId = clientRow?.client_id
  const clientData = clientRow?.clients as unknown as { full_name: string; dob: string | null } | null
  const participantName = clientData?.full_name ?? 'Participant'

  function startEdit() {
    setEditName(participantName)
    setEditDob(clientData?.dob ?? '')
    setEditMode(true)
  }

  async function saveEdit() {
    if (!editName.trim() || !clientId) return
    setSaving(true)
    await supabase.from('clients').update({ full_name: editName.trim(), dob: editDob || null }).eq('id', clientId)
    setSaving(false)
    qc.invalidateQueries({ queryKey: ['family-client'] })
    setEditMode(false)
  }

  const retentionCutoff = useMemo(() => {
    if (!isFamilyPlan) return null
    const d = new Date(Date.now() - RETENTION_DAYS * 86_400_000)
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }, [isFamilyPlan])

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['family-journal', clientId, retentionCutoff],
    queryFn: async () => {
      let q = supabase
        .from('log_entries')
        .select('*')
        .eq('client_id', clientId!)
        .order('occurred_at', { ascending: false })
        .limit(200)
      if (retentionCutoff) q = q.gte('occurred_at', retentionCutoff)
      const { data, error } = await q
      if (error) throw error
      return data as LogEntry[]
    },
    enabled: !!clientId,
  })

  const { data: notices = [] } = useQuery({
    queryKey: ['client-notices', clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from('notices')
        .select('*, profiles!author_id(full_name)')
        .eq('client_id', clientId!)
        .order('created_at', { ascending: false })
        .limit(5)
      return data ?? []
    },
    enabled: !!clientId,
  })

  const authorIds = [...new Set(entries.map((e) => e.author_id))]
  const { data: authorMap = {} } = useQuery({
    queryKey: ['author-names', authorIds.sort().join(',')],
    queryFn: async () => {
      if (!authorIds.length) return {}
      const { data } = await supabase.from('profiles').select('id, full_name').in('id', authorIds)
      const map: Record<string, string> = {}
      for (const p of data ?? []) map[p.id] = p.full_name
      return map
    },
    enabled: authorIds.length > 0,
    staleTime: 60_000,
  })

  const entriesWithAuthors: EntryWithAuthor[] = entries.map((e) => ({
    ...e,
    author_name: authorMap[e.author_id],
  }))

  const filteredEntries = selectedDate
    ? entriesWithAuthors.filter(e => toLocalDate(e.occurred_at) === selectedDate)
    : entriesWithAuthors
  const grouped = groupByDate(filteredEntries)
  const currentUserName = profile?.full_name ?? ''

  async function saveEntryEdit(id: string, label: string, type: LogType, moodScore: number) {
    const { error } = await (supabase.from('log_entries') as any)
      .update({ label: label.trim() || '📝', type, mood_score: moodScore })
      .eq('id', id)
    if (error) throw error
    qc.invalidateQueries({ queryKey: ['family-journal', clientId] })
    setEditingEntry(null)
  }

  async function deleteEntry(id: string) {
    const { error } = await supabase.from('log_entries').delete().eq('id', id)
    if (error) throw error
    qc.invalidateQueries({ queryKey: ['family-journal', clientId] })
    setEditingEntry(null)
  }

  async function deleteOwnEntry(id: string) {
    const { error } = await supabase.from('log_entries').delete().eq('id', id)
    if (error) throw error
    qc.invalidateQueries({ queryKey: ['family-journal', clientId] })
  }

  // Realtime subscription — push new/updated/deleted entries to all viewers
  useEffect(() => {
    if (!clientId) return
    const ch = supabase
      .channel(`journal-${clientId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'log_entries',
        filter: `client_id=eq.${clientId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['family-journal', clientId] })
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notices',
        filter: `client_id=eq.${clientId}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['client-notices', clientId] })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [clientId, qc])

  // Delete expired entries (+ their photos) for free Family plan — once per session per client
  useEffect(() => {
    if (!isFamilyPlan || !clientId) return
    const key = `retention-cleanup-${clientId}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')

    async function runCleanup() {
      const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
      const { data: expired } = await supabase
        .from('log_entries')
        .select('id, photo_path')
        .eq('client_id', clientId!)
        .lt('occurred_at', cutoff)
      if (!expired?.length) return

      const photoPaths = expired.flatMap(e => e.photo_path ? [e.photo_path as string] : [])
      if (photoPaths.length) {
        await supabase.storage.from('journal-photos').remove(photoPaths)
      }
      await supabase.from('log_entries').delete().in('id', expired.map(e => e.id))
      qc.invalidateQueries({ queryKey: ['family-journal', clientId] })
    }

    runCleanup()
  }, [isFamilyPlan, clientId, qc])

  // Tick every second while any own entry is still within the 60s window
  const hasRecentOwn = entries.some(
    e => e.author_id === user?.id && Date.now() - new Date(e.created_at).getTime() < 60_000
  )
  useEffect(() => {
    if (!hasRecentOwn) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasRecentOwn])

  async function deleteNotice(id: string) {
    await supabase.from('notices').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['client-notices', clientId] })
  }

  return (
    <div style={{ minHeight: '100dvh', background: themedPageBackground(theme), paddingBottom: 'calc(56px + var(--safe-bottom))' }}>

      {/* Header */}
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
        padding: '0.875rem 1.25rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600 }}>Companion</span>
          <span className="badge badge-sage" style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>
            {isCoordinator ? 'Coordinator' : isRecipient ? 'Recipient' : 'Family'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative' }}>
          {(currentUserName || user?.email) && (
            <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)', textAlign: 'right', lineHeight: 1.35 }}>
              {currentUserName && <>{currentUserName}<br /></>}
              <span style={{ opacity: 0.75 }}>{user?.email}</span>
            </span>
          )}
          {isCoordinator && (
            <>
              <button
                onClick={() => setShowMenu(m => !m)}
                style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.4rem 0.6rem', cursor: 'pointer', lineHeight: 1, color: 'var(--color-text)', display: 'flex', alignItems: 'center' }}
                title="Menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
                </svg>
              </button>
              {showMenu && (
                <>
                  <div onClick={() => setShowMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20,
                    background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                    borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                    minWidth: 180, overflow: 'hidden',
                  }}>
                    {[
                      { label: '👥 Members', path: '/members' },
                      { label: '🔐 Permissions', path: '/settings/permissions' },
                      { label: '📋 Release notes', path: '/release-notes' },
                    ].map(({ label, path }) => (
                      <button key={path} onClick={() => { navigate(path); setShowMenu(false) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--color-border)', padding: '0.7rem 1rem', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                        {label}
                      </button>
                    ))}
                    <button onClick={() => {
                        setShowMenu(false)
                        navigator.serviceWorker?.getRegistration().then(r => r?.update())
                        window.location.reload()
                      }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--color-border)', padding: '0.7rem 1rem', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                      🔄 Check for updates
                    </button>
                    <button onClick={() => { handleSignOut(); setShowMenu(false) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--color-border)', padding: '0.7rem 1rem', cursor: 'pointer', fontSize: '0.875rem', color: '#ef4444' }}>
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {!isCoordinator && (
            <button className="btn btn-ghost" onClick={handleSignOut}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}>Sign out</button>
          )}
        </div>
      </header>

      <ScheduleStatusBar />

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '1rem' }}>

        {/* Participant name + edit */}
        {editMode ? (
          <div style={{ marginBottom: '1rem' }}>
            <p className="eyebrow" style={{ margin: '0 0 0.5rem' }}>Edit participant</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)}
                placeholder="Full name" autoFocus />
              <input type="date" className="input" value={editDob} onChange={(e) => setEditDob(e.target.value)} />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-ghost" onClick={() => setEditMode(false)} style={{ flex: 1 }}>Cancel</button>
                <button className="btn btn-primary" onClick={saveEdit} disabled={saving || !editName.trim()} style={{ flex: 2 }}>
                  {saving ? <span className="spinner" /> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div style={{ minWidth: 0 }}>
                <p className="eyebrow" style={{ margin: 0 }}>Care journal</p>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {participantName}
                </h1>
              </div>
              {isCoordinator && (
                <button className="icon-btn" onClick={startEdit} title="Edit participant"><EditIcon size={16} /></button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, marginLeft: '0.75rem' }}>
              <button className="btn btn-ghost" onClick={() => setShowCalendar(true)}
                style={{ fontSize: '1rem', padding: '0.4rem 0.6rem' }} title="Filter by date">
                📅
              </button>
              <button className="btn btn-primary" onClick={() => navigate('/family/add')}
                style={{ fontSize: '0.875rem' }}>
                + Add
              </button>
            </div>
          </div>
        )}

        {/* Active notices */}
        {notices.map((n: any) => (
          <div key={n.id} className="card surface-note" style={{ marginBottom: '0.75rem', position: 'relative', padding: '0.875rem 1rem' }}>
            <p style={{ margin: '0 1.5rem 0.4rem 0', fontSize: 'var(--text-base)', fontWeight: 500, lineHeight: 1.5, display: 'flex', gap: '0.4rem' }}>
              <NoticesIcon size={16} /> {n.body}
            </p>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
              {n.profiles?.full_name ?? 'Someone'} · {formatDate(n.created_at)}
            </p>
            {(n.author_id === user?.id || isCoordinator) && (
              <button onClick={() => deleteNotice(n.id)} aria-label="Delete notice" className="icon-btn icon-btn-danger" style={{
                position: 'absolute', top: 6, right: 6, width: 30, height: 30,
              }}><TrashIcon size={16} /></button>
            )}
          </div>
        ))}

        {/* Feedback about the participant, from the whole care team */}
        {clientId && org && (
          <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
            <button
              onClick={() => setShowFeedback((x) => !x)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                width: '100%', background: 'none', border: 'none', padding: 0,
                cursor: 'pointer', textAlign: 'left', fontSize: '0.9375rem', fontWeight: 500,
              }}
            >
              💬 Feedback for {participantName}
              <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{showFeedback ? '▲' : '▼'}</span>
            </button>
            {showFeedback && (
              <div style={{ marginTop: '0.875rem' }}>
                <ClientFeedback clientId={clientId} orgId={org.id} />
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 0' }}>
            <div className="spinner" style={{ width: 28, height: 28, color: 'var(--color-primary)' }} />
          </div>
        )}

        {!isLoading && entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--color-muted)' }}>
            <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📔</p>
            <p style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.25rem' }}>No entries yet</p>
            <p style={{ fontSize: '0.875rem' }}>Add your first moment from {participantName}'s day.</p>
          </div>
        )}

        {entries.length > 0 && <MoodChart entries={entries} />}

        {/* Date filter bar */}
        {entries.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '1rem 0 0.25rem' }}>
            <button
              onClick={() => setShowCalendar(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                background: selectedDate ? 'color-mix(in srgb, var(--color-primary) 12%, transparent)' : 'var(--color-surface)',
                border: `1px solid ${selectedDate ? 'var(--color-primary)' : 'var(--color-border)'}`,
                borderRadius: 20, padding: '0.3rem 0.8rem', cursor: 'pointer',
                fontSize: '0.8125rem', fontWeight: 500,
                color: selectedDate ? 'var(--color-primary)' : 'var(--color-muted)',
              }}
            >
              <span style={{ fontSize: '0.9rem' }}>📅</span>
              {selectedDate
                ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
                : 'All entries'}
            </button>
            {selectedDate && (
              <button onClick={() => setSelectedDate(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--color-muted)', padding: '0.1rem 0.3rem', lineHeight: 1 }}
                title="Clear filter">×</button>
            )}
            {selectedDate && (
              <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)', marginLeft: 'auto' }}>
                {filteredEntries.length} {filteredEntries.length === 1 ? 'entry' : 'entries'}
              </span>
            )}
          </div>
        )}

        {/* No entries for selected date */}
        {selectedDate && filteredEntries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--color-muted)' }}>
            <p style={{ fontSize: '1.5rem', margin: '0 0 0.5rem' }}>📭</p>
            <p style={{ fontSize: '0.9rem', margin: 0 }}>No entries for this day</p>
          </div>
        )}

        {grouped.map(([date, dayEntries]) => (
          <div key={date}>
            <p style={{
              fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: 'var(--color-muted)', margin: '1.25rem 0 0.5rem',
            }}>{date}</p>
            {dayEntries.map((e) => {
              const isOwnEntry = e.author_id === user?.id
              const canDeleteOwn = isOwnEntry && (now - new Date(e.created_at).getTime()) < 60_000
              return (
                <EntryCard key={e.id} entry={e} showAuthor={true}
                  canEdit={isOwnEntry} canShare={canShare}
                  canDeleteOwn={canDeleteOwn} now={now}
                  expiryDays={isFamilyPlan ? daysUntilExpiry(e.occurred_at) : undefined}
                  onEdit={setEditingEntry} onDelete={deleteOwnEntry} />
              )
            })}
          </div>
        ))}


        {/* Install app banner */}
        {canInstall && !isIOS && (
          <div className="card" style={{ marginTop: '1.5rem', padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))' }}>
            <span style={{ fontSize: '1.4rem' }}>📱</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>Add to home screen</p>
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>Install Companion for quick access, even offline.</p>
            </div>
            <button className="btn btn-primary" onClick={install} style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', flexShrink: 0 }}>Install</button>
          </div>
        )}
        {canInstall && isIOS && (
          <div className="card" style={{ marginTop: '1.5rem', padding: '0.875rem 1rem', background: 'color-mix(in srgb, var(--color-primary) 8%, var(--color-surface))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: showIOSTip ? '0.75rem' : 0 }}>
              <span style={{ fontSize: '1.4rem' }}>📱</span>
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>Add to home screen</p>
                <p style={{ margin: '0.1rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>Install Companion for quick access.</p>
              </div>
              <button className="btn btn-primary" onClick={() => setShowIOSTip(t => !t)} style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', flexShrink: 0 }}>
                {showIOSTip ? 'Got it' : 'How?'}
              </button>
            </div>
            {showIOSTip && (
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-muted)', lineHeight: 1.6, paddingLeft: '2.15rem' }}>
                Tap the <strong>Share</strong> button (⬆️) at the bottom of Safari, then choose <strong>Add to Home Screen</strong>.
              </p>
            )}
          </div>
        )}

        {/* Notification permission banner — only on touch devices or when installed as PWA */}
        {pushPermission === 'default' && !pushDismissed &&
         (window.matchMedia('(display-mode: standalone)').matches ||
          window.matchMedia('(hover: none) and (pointer: coarse)').matches) && (
          <div className="card" style={{ marginTop: '1rem', padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🔔</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>Get message notifications</p>
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>Know when someone sends you a message.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
              <button className="btn btn-ghost" onClick={() => { setPushDismissed(true); localStorage.setItem('push_dismissed','1') }}
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.6rem', color: 'var(--color-muted)' }}>Later</button>
              <button className="btn btn-primary" onClick={subscribe} disabled={subscribing}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}>
                {subscribing ? '…' : 'Enable'}
              </button>
            </div>
          </div>
        )}

        {/* Journal entry notification toggle — shown when push is active */}
        {pushPermission === 'granted' && notifyOnEntry !== null && (
          <div className="card" style={{ marginTop: '1rem', padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.4rem' }}>📓</span>
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.875rem' }}>New entry alerts</p>
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
                Notify me when a new journal entry is logged.
              </p>
            </div>
            {/* Toggle switch */}
            <button
              role="switch"
              aria-checked={!!notifyOnEntry}
              onClick={() => setNotifyOnEntry(!notifyOnEntry)}
              style={{
                position: 'relative', flexShrink: 0,
                width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer',
                background: notifyOnEntry ? 'var(--color-primary)' : 'var(--color-border)',
                transition: 'background 0.2s',
                padding: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 3,
                left: notifyOnEntry ? 21 : 3,
                width: 20, height: 20, borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                transition: 'left 0.18s',
                display: 'block',
              }} />
            </button>
          </div>
        )}

        <MobileFooter />
      </div>

      {editingEntry && (
        <EditEntryModal
          entry={editingEntry}
          canDelete={isCoordinator}
          onSave={saveEntryEdit}
          onDelete={deleteEntry}
          onClose={() => setEditingEntry(null)}
        />
      )}

      {showCalendar && (
        <CalendarSheet
          entries={entriesWithAuthors}
          selectedDate={selectedDate}
          onSelect={setSelectedDate}
          onClose={() => setShowCalendar(false)}
        />
      )}

      <FamilyBottomNav />
    </div>
  )
}
