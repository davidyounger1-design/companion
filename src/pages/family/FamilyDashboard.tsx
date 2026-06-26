import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import type { LogEntry } from '../../types/database'
import Lightbox from '../../components/Lightbox'
import { MoodBar, moodColor, moodEmoji } from '../../components/MoodSlider'
import type { LogType } from '../../types/database'

const APP_VERSION = '0.2.0'

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

function MediaEntry({ path }: { path: string }) {
  const [lightbox, setLightbox] = useState<string | null>(null)
  const { data: url } = useQuery({
    queryKey: ['media-url', path],
    queryFn: async () => {
      const { data } = await supabase.storage.from('journal-photos').createSignedUrl(path, 3600)
      return data?.signedUrl ?? null
    },
    staleTime: 3_500_000,
  })
  if (!url) return null
  const video = isVideoPath(path)
  return (
    <>
      {video ? (
        <video src={url} controls style={{ width: '100%', borderRadius: 8, marginTop: '0.75rem', maxHeight: 320, display: 'block' }} />
      ) : (
        <img src={url} alt="" onClick={() => setLightbox(url)}
          style={{ width: '100%', borderRadius: 8, marginTop: '0.75rem', maxHeight: 320, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
      )}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}

type EntryWithAuthor = LogEntry & { author_name?: string }

function EntryCard({
  entry, showAuthor, canEdit, onEdit,
}: {
  entry: EntryWithAuthor
  showAuthor: boolean
  canEdit: boolean
  onEdit: (e: EntryWithAuthor) => void
}) {
  return (
    <div className="card" style={{ marginBottom: '0.75rem', cursor: canEdit ? 'pointer' : 'default' }}
      onClick={() => canEdit && onEdit(entry)}>
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
          {canEdit && <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>✏️</span>}
        </div>
      </div>
      {entry.photo_path && <MediaEntry path={entry.photo_path} />}
    </div>
  )
}

function EditEntryModal({
  entry, onSave, onClose,
}: {
  entry: EntryWithAuthor
  onSave: (id: string, label: string, type: LogType, moodScore: number) => Promise<void>
  onClose: () => void
}) {
  const [editLabel, setEditLabel] = useState(entry.label === '📷' || entry.label === '🎥' ? '' : entry.label)
  const [editType, setEditType] = useState<LogType>((LOG_TYPES.find(t => t.type === entry.type)?.type ?? 'note') as LogType)
  const [editMood, setEditMood] = useState(entry.mood_score ?? 50)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true)
    try { await onSave(entry.id, editLabel, editType, editMood) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); setSaving(false) }
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

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}
            disabled={saving || (!editLabel.trim() && !entry.photo_path)} style={{ flex: 2 }}>
            {saving ? <span className="spinner" /> : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Simple SVG mood chart
function MoodChart({ entries }: { entries: Array<{ occurred_at: string; mood_score: number | null }> }) {
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

  const W = 280, H = 80, PAD = 8
  const xStep = (W - PAD * 2) / 13
  const yScale = (v: number) => H - PAD - ((v / 100) * (H - PAD * 2))

  const linePts = points
    .map((p, i) => p !== null ? `${PAD + i * xStep},${yScale(p)}` : null)
    .filter(Boolean)

  const pathD = linePts.reduce((acc, pt, i) => acc + (i === 0 ? `M ${pt}` : ` L ${pt}`), '')

  return (
    <div style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.5rem' }}>
        <p style={{ margin: 0, fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)' }}>
          Mood · last 14 days
        </p>
        <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
          avg {moodEmoji(avg)} {avg}/100
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }}>
        {/* Avg line */}
        <line x1={PAD} y1={yScale(avg)} x2={W - PAD} y2={yScale(avg)}
          stroke="var(--color-border)" strokeWidth={1} strokeDasharray="4 3" />
        {/* Mood line */}
        {pathD && <path d={pathD} fill="none" stroke="var(--color-primary)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />}
        {/* Points */}
        {points.map((p, i) => p !== null ? (
          <circle key={i} cx={PAD + i * xStep} cy={yScale(p)} r={3}
            fill={moodColor(p)} stroke="#fff" strokeWidth={1.5} />
        ) : null)}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.2rem' }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)' }}>14 days ago</span>
        <span style={{ fontSize: '0.65rem', color: 'var(--color-muted)' }}>Today</span>
      </div>
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

export default function FamilyDashboard() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()

  const isCoordinator = profile?.role === 'coordinator'
  const isFamily = profile?.role === 'family'
  const canEdit = isCoordinator || isFamily

  const [editingEntry, setEditingEntry] = useState<EntryWithAuthor | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDob, setEditDob] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  const { data: clientRow } = useQuery({
    queryKey: ['family-client', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_family')
        .select('client_id, clients(full_name, dob)')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return data
    },
    enabled: !!user,
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

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['family-journal', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('log_entries')
        .select('*')
        .eq('client_id', clientId!)
        .order('occurred_at', { ascending: false })
        .limit(200)
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

  const grouped = groupByDate(entriesWithAuthors)
  const currentUserName = profile?.full_name ?? ''

  async function saveEntryEdit(id: string, label: string, type: LogType, moodScore: number) {
    const { error } = await (supabase.from('log_entries') as any)
      .update({ label: label.trim() || '📝', type, mood_score: moodScore })
      .eq('id', id)
    if (error) throw error
    qc.invalidateQueries({ queryKey: ['family-journal', clientId] })
    setEditingEntry(null)
  }

  async function deleteNotice(id: string) {
    await supabase.from('notices').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['client-notices', clientId] })
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '5rem' }}>
      {/* Header */}
      <div style={{
        padding: '1rem 1rem 0', position: 'sticky', top: 0,
        background: 'var(--color-bg)', zIndex: 10, borderBottom: '1px solid var(--color-border)',
      }}>
        <div style={{ maxWidth: 520, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.75rem' }}>
          {editMode ? (
            <div style={{ flex: 1 }}>
              <p className="eyebrow" style={{ margin: '0 0 0.4rem' }}>Edit participant</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)}
                  placeholder="Full name" autoFocus style={{ fontSize: '0.9rem', minHeight: 36, padding: '0.4rem 0.75rem', width: 160 }} />
                <input type="date" className="input" value={editDob} onChange={(e) => setEditDob(e.target.value)}
                  style={{ fontSize: '0.9rem', minHeight: 36, padding: '0.4rem 0.75rem', width: 150 }} />
                <button className="btn btn-primary" onClick={saveEdit} disabled={saving || !editName.trim()}
                  style={{ fontSize: '0.85rem', minHeight: 36, padding: '0.4rem 1rem' }}>
                  {saving ? <span className="spinner" /> : 'Save'}
                </button>
                <button className="btn btn-ghost" onClick={() => setEditMode(false)}
                  style={{ fontSize: '0.85rem', minHeight: 36, padding: '0.4rem 0.75rem' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div>
                  <p className="eyebrow" style={{ margin: 0 }}>Care journal</p>
                  <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{participantName}</h1>
                </div>
                {isCoordinator && (
                  <button className="btn btn-ghost" onClick={startEdit}
                    style={{ fontSize: '1rem', padding: '0.2rem 0.4rem', lineHeight: 1 }} title="Edit participant">✏️</button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                {isCoordinator && (
                  <button className="btn btn-ghost" onClick={() => navigate('/members')} style={{ fontSize: '0.8rem' }}>Members</button>
                )}
                <button className="btn btn-ghost" onClick={() => navigate('/family/messages')} style={{ fontSize: '0.8rem' }} title="Messages">💬</button>
                <button className="btn btn-ghost" onClick={() => navigate('/family/notices')} style={{ fontSize: '0.8rem' }} title="Notice board">📌</button>
                <button className="btn btn-primary" onClick={() => navigate('/family/add')} style={{ fontSize: '0.875rem' }}>+ Add</button>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>Sign out</button>
                  {(currentUserName || user?.email) && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)', paddingRight: '0.25rem', textAlign: 'right', lineHeight: 1.4 }}>
                      {currentUserName && <>{currentUserName}<br /></>}{user?.email}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '1rem' }}>
        {/* Active notices */}
        {notices.map((n: any) => (
          <div key={n.id} style={{
            background: '#fff8e1', border: '2px solid #ffc107', borderRadius: 12,
            padding: '0.875rem 1rem', marginBottom: '0.75rem', position: 'relative',
          }}>
            <p style={{ margin: '0 1.5rem 0.4rem 0', fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.5 }}>
              📌 {n.body}
            </p>
            <p style={{ margin: 0, fontSize: '0.72rem', color: '#8a6d00' }}>
              {n.profiles?.full_name ?? 'Someone'} · {formatDate(n.created_at)}
            </p>
            {(n.author_id === user?.id || isCoordinator) && (
              <button onClick={() => deleteNotice(n.id)} style={{
                position: 'absolute', top: 8, right: 8, background: 'none', border: 'none',
                cursor: 'pointer', fontSize: '0.85rem', color: '#8a6d00', padding: '0.2rem 0.4rem',
              }}>✕</button>
            )}
          </div>
        ))}

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

        {/* Mood tracker */}
        {entries.length > 0 && <MoodChart entries={entries} />}

        {grouped.map(([date, dayEntries]) => (
          <div key={date}>
            <p style={{
              fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase',
              letterSpacing: '0.08em', color: 'var(--color-muted)', margin: '1.25rem 0 0.5rem',
            }}>{date}</p>
            {dayEntries.map((e) => (
              <EntryCard key={e.id} entry={e} showAuthor={true}
                canEdit={canEdit} onEdit={setEditingEntry} />
            ))}
          </div>
        ))}

        {/* Version footer */}
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <button onClick={() => navigate('/release-notes')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.72rem', color: 'var(--color-muted)' }}>
            Companion v{APP_VERSION}
          </button>
        </div>
      </div>

      {editingEntry && (
        <EditEntryModal entry={editingEntry} onSave={saveEntryEdit} onClose={() => setEditingEntry(null)} />
      )}
    </div>
  )
}
