import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useFeatures } from '../../hooks/useFeatures'
import { FEATURES } from '../../lib/features'
import { useScheduleSkips } from '../../hooks/useScheduleSkips'
import AiBadge from '../../components/AiBadge'
import MoodSlider from '../../components/MoodSlider'
import { MoodBar, moodColor, moodEmoji } from '../../components/MoodSlider'
import Lightbox from '../../components/Lightbox'
import EntryComments from '../../components/EntryComments'
import EntryReactions from '../../components/EntryReactions'
import SegmentedControl from '../../components/SegmentedControl'
import ClientManagePanel from '../../components/ClientManagePanel'
import { BackIcon, PlusIcon } from '../../components/icons'
import {
  WeekView, ScheduleCard, ScheduleItemForm, ScopeChooser, CopyDayModal, type FormIntent,
} from '../family/FamilySchedule'
import {
  toLocalDateStr, parseLocalDate, timeToMinutes, occursOnDateActive, getItemStatus,
} from '../../lib/schedule'
import type { LogType, ScheduleItem } from '../../types/database'

const LOG_TYPES: { type: LogType; icon: string; label: string }[] = [
  { type: 'meal',     icon: '🍽️', label: 'Meal' },
  { type: 'activity', icon: '🌿', label: 'Activity' },
  { type: 'mood',     icon: '😊', label: 'Mood' },
  { type: 'note',     icon: '📝', label: 'Note' },
]

const schema = z.object({ label: z.string() })
type FormData = z.infer<typeof schema>

function fileExt(file: File) {
  return file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
}
function isVideoFile(file: File) {
  return file.type.startsWith('video/')
}
function isVideoPath(path: string) {
  return /\.(mp4|mov|webm|m4v|avi|ogv)(\?|$)/i.test(path)
}

function MediaCell({ path }: { path: string }) {
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
        <video src={url} controls style={{ width: '100%', borderRadius: 6, marginTop: '0.5rem', maxHeight: 220, display: 'block' }} />
      ) : (
        <img src={url} alt="" onClick={() => setLightbox(url)}
          style={{ width: '100%', borderRadius: 6, marginTop: '0.5rem', maxHeight: 220, objectFit: 'cover', display: 'block', cursor: 'zoom-in' }} />
      )}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </>
  )
}

type Tab = 'activity' | 'schedule' | 'manage'

export default function CoordinatorClientDetail() {
  const { clientId } = useParams<{ clientId: string }>()
  const { user, profile } = useAuth()
  const { has } = useFeatures()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('activity')

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ['client', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', clientId!).single()
      if (error) throw error
      return data
    },
    enabled: !!clientId,
  })

  if (clientLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem' }}>
        <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
      </div>
    )
  }

  if (!client || !profile?.org_id || !user) {
    return (
      <div className="page">
        <p style={{ color: 'var(--color-muted)' }}>Participant not found.</p>
        <button className="btn btn-ghost" onClick={() => navigate('/dashboard')}>← Back</button>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      <header className="no-print" style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
        padding: '0.875rem 1.25rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button className="icon-btn" aria-label="Back" onClick={() => navigate('/dashboard')}><BackIcon /></button>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {client.full_name}
          </h1>
          {client.setting && <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-muted)' }}>{client.setting}</p>}
        </div>
      </header>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '1rem 1rem calc(1rem + env(safe-area-inset-bottom))' }}>
        <div className="no-print" style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem' }}>
          <SegmentedControl
            value={tab}
            onChange={setTab}
            options={[
              { value: 'activity', label: 'Activity' },
              { value: 'schedule', label: 'Schedule' },
              { value: 'manage', label: 'Manage' },
            ]}
          />
        </div>

        {tab === 'activity' && (
          <ActivityTab clientId={client.id} orgId={profile.org_id} authorId={user.id} showMood={has(FEATURES.moodTracking)} />
        )}

        {tab === 'schedule' && (
          <ScheduleTab clientId={client.id} orgId={profile.org_id} userId={user.id} participantName={client.full_name} />
        )}

        {tab === 'manage' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <ClientManagePanel
              clientId={client.id}
              participantName={client.full_name}
              orgId={profile.org_id}
              onRemoved={() => {
                qc.invalidateQueries({ queryKey: ['clients', profile.org_id] })
                navigate('/dashboard')
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Activity tab — full journal history + add-entry, since a coordinator is
// effectively also a worker for any participant they oversee. ──────────────

function ActivityTab({
  clientId, orgId, authorId, showMood,
}: {
  clientId: string
  orgId: string
  authorId: string
  showMood: boolean
}) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [selectedType, setSelectedType] = useState<LogType>('activity')
  const [newMood, setNewMood] = useState(50)
  const [successMsg, setSuccessMsg] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editType, setEditType] = useState<LogType>('activity')
  const [editLabel, setEditLabel] = useState('')
  const [editMood, setEditMood] = useState(50)

  const [media, setMedia] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { register, handleSubmit, reset } = useForm<FormData>({ resolver: zodResolver(schema) })

  const { data: entries, isLoading } = useQuery({
    queryKey: ['coordinator-journal', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('log_entries')
        .select('*')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return data
    },
    enabled: !!clientId,
  })

  const authorIds = [...new Set((entries ?? []).map((e) => e.author_id))]
  const { data: authorMap = {} } = useQuery({
    queryKey: ['author-names', authorIds.sort().join(',')],
    queryFn: async () => {
      if (!authorIds.length) return {} as Record<string, string>
      const { data } = await supabase.from('profiles').select('id, full_name').in('id', authorIds)
      const map: Record<string, string> = {}
      for (const p of data ?? []) map[p.id] = p.full_name
      return map
    },
    enabled: authorIds.length > 0,
    staleTime: 60_000,
  })

  function pickMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setMedia(file)
    setPreview(URL.createObjectURL(file))
  }
  function removeMedia() {
    setMedia(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }
  function resetForm() {
    setShowForm(false)
    setMedia(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
    setNewMood(50)
    reset()
  }
  function startEdit(log: { id: string; type: string; label: string; mood_score?: number | null }) {
    setEditingId(log.id)
    setEditType((LOG_TYPES.find((t) => t.type === log.type)?.type ?? 'note') as LogType)
    setEditLabel(log.label === '📷' || log.label === '🎥' ? '' : log.label)
    setEditMood(log.mood_score ?? 50)
  }
  function cancelEdit() { setEditingId(null) }

  const addLog = useMutation({
    mutationFn: async ({ label, mediaFile }: { label: string; mediaFile: File | null }) => {
      let photoPath: string | null = null
      if (mediaFile) {
        const ext = fileExt(mediaFile)
        const uuid = crypto.randomUUID()
        photoPath = `${orgId}/${clientId}/${authorId}/${uuid}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('journal-photos')
          .upload(photoPath, mediaFile, { upsert: false })
        if (uploadErr) throw uploadErr
      }
      const { error } = await supabase.from('log_entries').insert({
        client_id: clientId,
        org_id: orgId,
        author_id: authorId,
        type: selectedType,
        label: label.trim() || (mediaFile && isVideoFile(mediaFile) ? '🎥' : mediaFile ? '📷' : '📝'),
        occurred_at: new Date().toISOString(),
        photo_path: photoPath,
        mood_score: newMood,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinator-journal', clientId] })
      resetForm()
      setSuccessMsg('Entry saved!')
      setTimeout(() => setSuccessMsg(''), 3000)
    },
  })

  const updateLog = useMutation({
    mutationFn: async ({ id, label, type, moodScore }: { id: string; label: string; type: LogType; moodScore: number }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('log_entries') as any)
        .update({ label: label.trim() || '📝', type, mood_score: moodScore })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['coordinator-journal', clientId] })
      setEditingId(null)
    },
  })

  const deleteLog = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('log_entries').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coordinator-journal', clientId] }),
  })

  return (
    <div>
      {successMsg && <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{successMsg}</div>}

      {!showForm ? (
        <button className="btn btn-primary btn-full" onClick={() => setShowForm(true)} style={{ marginBottom: '1.5rem' }}>
          + Add log entry
        </button>
      ) : (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>New log entry</p>
          <div className="log-type-grid" style={{ marginBottom: '1rem' }}>
            {LOG_TYPES.filter((t) => showMood || t.type !== 'mood').map(({ type, icon, label }) => (
              <button key={type} type="button" className={`log-type-btn${selectedType === type ? ' selected' : ''}`}
                onClick={() => setSelectedType(type)}>
                <span className="icon">{icon}</span>{label}
              </button>
            ))}
          </div>
          <form onSubmit={handleSubmit((d) => {
            if (!d.label.trim() && !media) return
            addLog.mutate({ label: d.label, mediaFile: media })
          })} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="field">
              <label htmlFor="label">
                {selectedType === 'meal'     && 'What did they eat or drink?'}
                {selectedType === 'activity' && 'What did they do?'}
                {selectedType === 'mood'     && 'How were they feeling?'}
                {selectedType === 'note'     && 'Note (optional if adding a photo or video)'}
              </label>
              <textarea id="label" className="input" rows={3}
                placeholder={
                  selectedType === 'meal'     ? 'e.g. Porridge with banana, decaf coffee' :
                  selectedType === 'activity' ? 'e.g. Walked to the park, fed the ducks' :
                  selectedType === 'mood'     ? 'e.g. Calm and engaged all morning' :
                  'Add a note…'
                }
                style={{ resize: 'vertical' }}
                {...register('label')}
              />
            </div>

            {showMood && <MoodSlider value={newMood} onChange={setNewMood} />}

            <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={pickMedia} />
            {preview ? (
              <div style={{ position: 'relative' }}>
                {media && isVideoFile(media) ? (
                  <video src={preview} controls style={{ width: '100%', borderRadius: 8, maxHeight: 260, display: 'block' }} />
                ) : (
                  <img src={preview} alt="Preview" style={{ width: '100%', borderRadius: 8, maxHeight: 260, objectFit: 'cover', display: 'block' }} />
                )}
                <button type="button" onClick={removeMedia} style={{
                  position: 'absolute', top: 8, right: 8,
                  background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
                  borderRadius: '50%', width: 28, height: 28, cursor: 'pointer',
                  fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>✕</button>
              </div>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} style={{
                width: '100%', border: '2px dashed var(--color-border)', borderRadius: 8,
                padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '0.5rem', color: 'var(--color-muted)', fontSize: '0.875rem',
              }}>
                <span style={{ fontSize: '1.1rem' }}>📷</span>
                Add a photo or video (optional)
              </button>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" className="btn btn-ghost" onClick={resetForm} style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={addLog.isPending} style={{ flex: 2 }}>
                {addLog.isPending ? <span className="spinner" /> : 'Save entry'}
              </button>
            </div>
            {addLog.isError && (
              <div className="alert alert-error">
                {addLog.error instanceof Error ? addLog.error.message : 'Could not save. Try again.'}
              </div>
            )}
          </form>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <h2 style={{ fontSize: '1rem', fontFamily: 'var(--font-ui)', fontWeight: 700, margin: 0 }}>Activity</h2>
        {entries && <span className="badge badge-muted">{entries.length} {entries.length === 1 ? 'entry' : 'entries'}</span>}
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : !entries?.length ? (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
          No activity logged yet.
        </p>
      ) : (
        <div className="scroll-list">
          {entries.map((log) => {
            const typeInfo = LOG_TYPES.find((t) => t.type === log.type)
            const isEditing = editingId === log.id
            const isOwn = log.author_id === authorId

            if (isEditing) {
              return (
                <div key={log.id} className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div className="log-type-grid">
                    {LOG_TYPES.filter((t) => showMood || t.type !== 'mood').map(({ type, icon, label }) => (
                      <button key={type} type="button" className={`log-type-btn${editType === type ? ' selected' : ''}`}
                        onClick={() => setEditType(type)}>
                        <span className="icon">{icon}</span>{label}
                      </button>
                    ))}
                  </div>
                  <textarea className="input" rows={2} value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                    autoFocus style={{ resize: 'vertical' }} />
                  {showMood && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <label style={{ fontSize: '0.8125rem', color: 'var(--color-muted)' }}>Mood rating</label>
                        <span>{moodEmoji(editMood)}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>😔</span>
                        <input type="range" min={0} max={100} value={editMood} onChange={(e) => setEditMood(+e.target.value)}
                          style={{ flex: 1, accentColor: moodColor(editMood) }} />
                        <span>😊</span>
                      </div>
                    </div>
                  )}
                  {updateLog.isError && (
                    <div className="alert alert-error" style={{ fontSize: '0.8rem' }}>
                      {updateLog.error instanceof Error ? updateLog.error.message : 'Could not save.'}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-ghost" onClick={cancelEdit} style={{ flex: 1, fontSize: '0.85rem' }}>Cancel</button>
                    <button className="btn btn-primary" disabled={updateLog.isPending} style={{ flex: 2, fontSize: '0.85rem' }}
                      onClick={() => updateLog.mutate({ id: log.id, label: editLabel, type: editType, moodScore: editMood })}>
                      {updateLog.isPending ? <span className="spinner" /> : 'Save changes'}
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div key={log.id} className="card card-sm" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '1.25rem', flexShrink: 0, cursor: isOwn ? 'pointer' : 'default' }}
                  onClick={() => isOwn && startEdit(log)}>{typeInfo?.icon ?? '📝'}</span>
                <div style={{ flex: 1, minWidth: 0, cursor: isOwn ? 'pointer' : 'default' }} onClick={() => isOwn && startEdit(log)}>
                  <p style={{ margin: 0, fontWeight: 500 }}>{log.label}</p>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                    {new Date(log.occurred_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{typeInfo?.label ?? log.type}
                    {authorMap[log.author_id] && <> · {authorMap[log.author_id]}</>}
                    {log.ai_source && log.ai_reason && <> · <AiBadge reason={log.ai_reason} /></>}
                  </p>
                  {showMood && <MoodBar score={log.mood_score} />}
                  {log.photo_path && <MediaCell path={log.photo_path} />}
                  <EntryReactions entryId={log.id} />
                  <EntryComments entryId={log.id} clientId={log.client_id} orgId={log.org_id} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', flexShrink: 0 }}>
                  {isOwn && <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', paddingTop: 2 }}>✏️</span>}
                  <button aria-label="Delete entry" className="icon-btn icon-btn-danger" style={{ width: 26, height: 26 }}
                    onClick={() => deleteLog.mutate(log.id)}>✕</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Schedule tab — day/week view + full CRUD, reusing the same subcomponents
// FamilySchedule.tsx uses (coordinators already have full RLS access here). ──

function ScheduleTab({ clientId, orgId, userId, participantName }: { clientId: string; orgId: string; userId: string; participantName: string }) {
  const qc = useQueryClient()
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateStr(new Date()))
  const [view, setView] = useState<'day' | 'week'>('day')
  const [now, setNow] = useState(() => Date.now())
  const [formIntent, setFormIntent] = useState<FormIntent | null>(null)
  const [scopeChoice, setScopeChoice] = useState<{ item: ScheduleItem; action: 'edit' | 'delete' } | null>(null)
  const [copyDayOpen, setCopyDayOpen] = useState(false)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const skips = useScheduleSkips(clientId)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['schedule-items', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_items').select('*').eq('client_id', clientId).eq('active', true)
      if (error) throw error
      return data as ScheduleItem[]
    },
    enabled: !!clientId,
  })

  const { data: completedIds = new Set<string>() } = useQuery({
    queryKey: ['schedule-completions', clientId, selectedDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_item_completions').select('schedule_item_id')
        .eq('client_id', clientId).eq('occurrence_date', selectedDate)
      if (error) throw error
      return new Set((data ?? []).map((c) => c.schedule_item_id))
    },
    enabled: !!clientId,
  })

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ['schedule-items', clientId] })
    qc.invalidateQueries({ queryKey: ['schedule-completions', clientId] })
    qc.invalidateQueries({ queryKey: ['schedule-skips', clientId] })
  }

  async function toggleComplete(item: ScheduleItem) {
    if (completedIds.has(item.id)) {
      await supabase.from('schedule_item_completions').delete()
        .eq('schedule_item_id', item.id).eq('occurrence_date', selectedDate)
    } else {
      await supabase.from('schedule_item_completions').insert({
        schedule_item_id: item.id, occurrence_date: selectedDate,
        client_id: clientId, org_id: orgId, completed_by: userId,
      })
    }
    qc.invalidateQueries({ queryKey: ['schedule-completions', clientId, selectedDate] })
  }

  async function deleteItem(id: string) {
    await supabase.from('schedule_items').delete().eq('id', id)
    invalidateAll()
  }

  async function skipOccurrence(item: ScheduleItem, date: string) {
    await supabase.from('schedule_item_skips').insert({
      schedule_item_id: item.id, occurrence_date: date, client_id: clientId, org_id: orgId, created_by: userId,
    })
    invalidateAll()
  }

  async function copyDayTo(fromDate: string, toDate: string) {
    const source = items.filter((i) => occursOnDateActive(i, fromDate, skips))
    if (source.length === 0) return
    const rows = source.map((i) => ({
      title: i.title, description: i.description, category: i.category,
      start_time: i.start_time, end_time: i.end_time, url: i.url,
      recurrence: 'once' as const, specific_date: toDate, days_of_week: null,
      client_id: clientId, org_id: orgId, created_by: userId,
    }))
    await supabase.from('schedule_items').insert(rows)
    invalidateAll()
  }

  function handleEdit(item: ScheduleItem) {
    if (item.recurrence === 'weekly') setScopeChoice({ item, action: 'edit' })
    else setFormIntent({ mode: 'edit', item })
  }
  function handleDelete(item: ScheduleItem) {
    if (item.recurrence === 'weekly') setScopeChoice({ item, action: 'delete' })
    else deleteItem(item.id)
  }

  const todayStr = toLocalDateStr(new Date())
  const isToday = selectedDate === todayStr
  const nowMinutes = isToday ? new Date(now).getHours() * 60 + new Date(now).getMinutes() : 0

  const dayItems = useMemo(() => {
    return items.filter((i) => occursOnDateActive(i, selectedDate, skips))
      .sort((a, b) => timeToMinutes(a.start_time) - timeToMinutes(b.start_time))
  }, [items, selectedDate, skips])

  const nextItem = isToday
    ? dayItems.find((i) => !completedIds.has(i.id) && getItemStatus(i, nowMinutes) === 'upcoming')
    : undefined

  function shiftDay(delta: number) {
    const d = parseLocalDate(selectedDate)
    d.setDate(d.getDate() + delta)
    setSelectedDate(toLocalDateStr(d))
  }
  function shiftWeek(delta: number) {
    const d = parseLocalDate(selectedDate)
    d.setDate(d.getDate() + delta * 7)
    setSelectedDate(toLocalDateStr(d))
  }

  const dateLabel = parseLocalDate(selectedDate).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })

  const weekDates = useMemo(() => {
    const sunday = parseLocalDate(selectedDate)
    sunday.setDate(sunday.getDate() - sunday.getDay())
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sunday)
      d.setDate(sunday.getDate() + i)
      return toLocalDateStr(d)
    })
  }, [selectedDate])

  const weekLabel = `${parseLocalDate(weekDates[0]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })} – ${parseLocalDate(weekDates[6]).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`

  return (
    <div>
      <p className="print-only" style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '1rem' }}>
        {participantName}'s schedule — {view === 'day' ? (isToday ? `Today, ${dateLabel}` : dateLabel) : weekLabel}
      </p>

      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.6rem', marginBottom: '1rem' }}>
        <button onClick={() => { setSelectedDate(todayStr); setView('day') }} className="btn btn-ghost"
          style={{ padding: '0.4rem 0.9rem', fontSize: '0.82rem', color: 'var(--color-primary)' }}>Today</button>
        <SegmentedControl value={view} onChange={setView} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />
        <button onClick={() => window.print()} className="btn btn-ghost" title="Print or save as PDF"
          style={{ padding: '0.4rem 0.9rem', fontSize: '0.82rem' }}>🖨️ Print</button>
      </div>

      {view === 'day' ? (
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={() => shiftDay(-1)} style={{ padding: '0.4rem 0.75rem', fontSize: '1rem' }}>←</button>
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem' }}>{isToday ? 'Today' : dateLabel}</p>
            {isToday && <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-muted)' }}>{dateLabel}</p>}
            {!isToday && (
              <button onClick={() => setSelectedDate(todayStr)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: '0.72rem', color: 'var(--color-primary)', fontWeight: 600,
              }}>Jump to today</button>
            )}
          </div>
          <button className="btn btn-ghost" onClick={() => shiftDay(1)} style={{ padding: '0.4rem 0.75rem', fontSize: '1rem' }}>→</button>
        </div>
      ) : (
        <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', gap: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={() => shiftWeek(-1)} style={{ padding: '0.4rem 0.75rem', fontSize: '1rem' }}>←</button>
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem' }}>{weekLabel}</p>
            {!weekDates.includes(todayStr) && (
              <button onClick={() => setSelectedDate(todayStr)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: '0.72rem', color: 'var(--color-primary)', fontWeight: 600,
              }}>Jump to this week</button>
            )}
          </div>
          <button className="btn btn-ghost" onClick={() => shiftWeek(1)} style={{ padding: '0.4rem 0.75rem', fontSize: '1rem' }}>→</button>
        </div>
      )}

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ color: 'var(--color-primary)' }} />
        </div>
      )}

      {view === 'day' && !isLoading && (
        <>
          {dayItems.length === 0 && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-muted)' }}>
              <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🌤️</p>
              <p>Nothing scheduled for this day yet.</p>
            </div>
          )}
          {dayItems.map((item) => (
            <ScheduleCard
              key={item.id}
              item={item}
              occurrenceDate={selectedDate}
              clientId={clientId}
              orgId={orgId}
              done={completedIds.has(item.id)}
              status={isToday ? getItemStatus(item, nowMinutes) : null}
              isNext={nextItem?.id === item.id}
              canManage
              showTimerButton={false}
              nowMinutes={nowMinutes}
              onToggleDone={() => toggleComplete(item)}
              onEdit={() => handleEdit(item)}
              onDelete={() => handleDelete(item)}
              onStartTimer={() => {}}
            />
          ))}
          {dayItems.length > 0 && (
            <button onClick={() => setCopyDayOpen(true)} className="btn btn-ghost no-print" style={{
              width: '100%', marginTop: '0.25rem', fontSize: '0.82rem', color: 'var(--color-primary)',
            }}>Copy this day to another date…</button>
          )}
        </>
      )}

      {view === 'week' && !isLoading && (
        <WeekView weekDates={weekDates} items={items} skips={skips} todayStr={todayStr}
          onSelectDay={(date) => { setSelectedDate(date); setView('day') }} />
      )}

      <button onClick={() => setFormIntent({ mode: 'new' })} aria-label="Add to schedule" className="fab"
        style={{ bottom: 'calc(1.25rem + var(--safe-bottom))' }}>
        <PlusIcon size={22} />
      </button>

      {formIntent && (
        <ScheduleItemForm
          intent={formIntent}
          clientId={clientId}
          orgId={orgId}
          userId={userId}
          defaultDate={selectedDate}
          onClose={() => setFormIntent(null)}
          onSaved={() => { setFormIntent(null); invalidateAll() }}
        />
      )}

      {scopeChoice && (
        <ScopeChooser
          item={scopeChoice.item}
          action={scopeChoice.action}
          date={selectedDate}
          onClose={() => setScopeChoice(null)}
          onEditSeries={() => { setFormIntent({ mode: 'edit', item: scopeChoice.item }); setScopeChoice(null) }}
          onEditThisDay={() => { setFormIntent({ mode: 'detach', item: scopeChoice.item, date: selectedDate }); setScopeChoice(null) }}
          onDeleteSeries={() => { deleteItem(scopeChoice.item.id); setScopeChoice(null) }}
          onDeleteThisDay={() => { skipOccurrence(scopeChoice.item, selectedDate); setScopeChoice(null) }}
        />
      )}

      {copyDayOpen && (
        <CopyDayModal
          fromDate={selectedDate}
          onClose={() => setCopyDayOpen(false)}
          onCopy={async (toDate) => { await copyDayTo(selectedDate, toDate); setCopyDayOpen(false) }}
        />
      )}
    </div>
  )
}
