import { useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import AiBadge from '../../components/AiBadge'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import MoodSlider from '../../components/MoodSlider'
import { MoodBar, moodColor, moodEmoji } from '../../components/MoodSlider'
import { useFeatures } from '../../hooks/useFeatures'
import { FEATURES } from '../../lib/features'
import Lightbox from '../../components/Lightbox'
import EntryComments from '../../components/EntryComments'
import EntryReactions from '../../components/EntryReactions'
import ClientFeedback from '../../components/ClientFeedback'
import BehaviourNoteForm from '../../components/BehaviourNoteForm'
import BehaviourNotesSection from '../../components/BehaviourNotesSection'
import IncidentForm from '../../components/IncidentForm'
import IncidentsSection from '../../components/IncidentsSection'
import NdisRecordsSection from '../../components/NdisRecordsSection'
import type { LogType } from '../../types/database'

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

export default function WorkerClientDetail() {
  const { clientId } = useParams<{ clientId: string }>()
  const { user, profile } = useAuth()
  const { has } = useFeatures()
  const showMood = has(FEATURES.moodTracking)
  const showBehaviourNotesFeature = has(FEATURES.behaviourNotes)
  const showIncidentWorkflows = has(FEATURES.incidentWorkflows)
  const showNdisRecords = has(FEATURES.ndisRecords)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [showFeedback, setShowFeedback] = useState(false)
  const [showBehaviourNotes, setShowBehaviourNotes] = useState(false)
  const [showBehaviourForm, setShowBehaviourForm] = useState(false)
  const [showIncidents, setShowIncidents] = useState(false)
  const [showIncidentForm, setShowIncidentForm] = useState(false)
  const [showGoals, setShowGoals] = useState(false)
  const [selectedType, setSelectedType] = useState<LogType>('activity')
  const [showForm, setShowForm] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [newMood, setNewMood] = useState(50)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editType, setEditType] = useState<LogType>('activity')
  const [editLabel, setEditLabel] = useState('')
  const [editMood, setEditMood] = useState(50)

  function startEdit(log: { id: string; type: string; label: string; mood_score?: number | null }) {
    setEditingId(log.id)
    setEditType((LOG_TYPES.find(t => t.type === log.type)?.type ?? 'note') as LogType)
    setEditLabel(log.label === '📷' || log.label === '🎥' ? '' : log.label)
    setEditMood(log.mood_score ?? 50)
  }

  function cancelEdit() { setEditingId(null) }

  const updateLog = useMutation({
    mutationFn: async ({ id, label, type, moodScore }: { id: string; label: string; type: LogType; moodScore: number }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from('log_entries') as any)
        .update({ label: label.trim() || '📝', type, mood_score: moodScore })
        .eq('id', id)
        .eq('author_id', user!.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs', clientId] })
      setEditingId(null)
    },
  })

  const [media, setMedia] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

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

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ['client', clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('*').eq('id', clientId!).single()
      if (error) throw error
      return data
    },
    enabled: !!clientId,
  })

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['logs', clientId],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('log_entries')
        .select('*')
        .eq('client_id', clientId!)
        .eq('author_id', user!.id)
        .gte('occurred_at', `${today}T00:00:00`)
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!clientId && !!user,
  })

  const { register, handleSubmit, reset } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const addLog = useMutation({
    mutationFn: async ({ label, mediaFile }: { label: string; mediaFile: File | null }) => {
      let photoPath: string | null = null
      if (mediaFile) {
        const ext = fileExt(mediaFile)
        const uuid = crypto.randomUUID()
        photoPath = `${profile!.org_id}/${clientId}/${user!.id}/${uuid}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('journal-photos')
          .upload(photoPath, mediaFile, { upsert: false })
        if (uploadErr) throw uploadErr
      }
      const { error } = await supabase.from('log_entries').insert({
        client_id: clientId!,
        org_id: profile!.org_id!,
        author_id: user!.id,
        type: selectedType,
        label: label.trim() || (mediaFile && isVideoFile(mediaFile) ? '🎥' : mediaFile ? '📷' : '📝'),
        occurred_at: new Date().toISOString(),
        photo_path: photoPath,
        mood_score: newMood,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs', clientId] })
      qc.invalidateQueries({ queryKey: ['today-logs-worker'] })
      resetForm()
      setSuccessMsg('Entry saved!')
      setTimeout(() => setSuccessMsg(''), 3000)
    },
  })

  if (clientLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem' }}>
        <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="page">
        <p style={{ color: 'var(--color-muted)' }}>Client not found.</p>
        <Link to="/worker" className="btn btn-ghost">← Back</Link>
      </div>
    )
  }

  return (
    <div className="page">
      <button className="btn btn-ghost" onClick={() => navigate('/worker')}
        style={{ padding: '0.25rem 0', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
        ← My clients
      </button>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 400, margin: '0 0 0.25rem' }}>{client.full_name}</h1>
        {client.setting && <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: 0 }}>{client.setting}</p>}
        {client.about?.loves && (
          <p style={{ fontSize: '0.85rem', marginTop: '0.75rem', margin: '0.75rem 0 0' }}>
            <span style={{ color: 'var(--color-muted)' }}>Loves: </span>{client.about.loves}
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1.25rem', padding: '0.875rem 1rem' }}>
        <button
          onClick={() => setShowFeedback((x) => !x)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left', fontSize: '0.9375rem', fontWeight: 500,
          }}
        >
          💬 Feedback for {client.full_name}
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{showFeedback ? '▲' : '▼'}</span>
        </button>
        {showFeedback && (
          <div style={{ marginTop: '0.875rem' }}>
            <ClientFeedback clientId={client.id} orgId={client.org_id} participantName={client.full_name} />
          </div>
        )}
      </div>

      {showBehaviourNotesFeature && <div className="card" style={{ marginBottom: '1.25rem', padding: '0.875rem 1rem' }}>
        <button
          onClick={() => setShowBehaviourNotes((x) => !x)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left', fontSize: '0.9375rem', fontWeight: 500,
          }}
        >
          🩺 Behaviour notes for {client.full_name}
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{showBehaviourNotes ? '▲' : '▼'}</span>
        </button>
        {showBehaviourNotes && (
          <div style={{ marginTop: '0.875rem' }}>
            {!showBehaviourForm ? (
              <button className="btn btn-primary btn-full" onClick={() => setShowBehaviourForm(true)} style={{ marginBottom: '1.25rem' }}>
                + Add behaviour note
              </button>
            ) : (
              <BehaviourNoteForm
                clientId={client.id}
                orgId={client.org_id}
                authorId={user!.id}
                onSaved={() => setShowBehaviourForm(false)}
                onCancel={() => setShowBehaviourForm(false)}
              />
            )}
            <BehaviourNotesSection clientId={client.id} participantName={client.full_name} />
          </div>
        )}
      </div>}

      {showIncidentWorkflows && <div className="card" style={{ marginBottom: '1.25rem', padding: '0.875rem 1rem' }}>
        <button
          onClick={() => setShowIncidents((x) => !x)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left', fontSize: '0.9375rem', fontWeight: 500,
          }}
        >
          🚨 Incidents for {client.full_name}
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{showIncidents ? '▲' : '▼'}</span>
        </button>
        {showIncidents && (
          <div style={{ marginTop: '0.875rem' }}>
            {!showIncidentForm ? (
              <button className="btn btn-primary btn-full" onClick={() => setShowIncidentForm(true)} style={{ marginBottom: '1.25rem' }}>
                + Report incident
              </button>
            ) : (
              <IncidentForm
                clientId={client.id}
                orgId={client.org_id}
                authorId={user!.id}
                onSaved={() => setShowIncidentForm(false)}
                onCancel={() => setShowIncidentForm(false)}
              />
            )}
            <IncidentsSection clientId={client.id} canManage={false} />
          </div>
        )}
      </div>}

      {showNdisRecords && <div className="card" style={{ marginBottom: '1.25rem', padding: '0.875rem 1rem' }}>
        <button
          onClick={() => setShowGoals((x) => !x)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left', fontSize: '0.9375rem', fontWeight: 500,
          }}
        >
          🎯 Goals for {client.full_name}
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{showGoals ? '▲' : '▼'}</span>
        </button>
        {showGoals && (
          <div style={{ marginTop: '0.875rem' }}>
            <NdisRecordsSection clientId={client.id} orgId={client.org_id} authorId={user!.id} canManageAny={false} />
          </div>
        )}
      </div>}

      {successMsg && (
        <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{successMsg}</div>
      )}

      {!showForm ? (
        <button className="btn btn-primary btn-full" onClick={() => setShowForm(true)}
          style={{ marginBottom: '1.5rem' }}>
          + Add log entry
        </button>
      ) : (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '0.95rem' }}>New log entry</p>

          <div className="log-type-grid" style={{ marginBottom: '1rem' }}>
            {LOG_TYPES.filter((t) => showMood || t.type !== 'mood').map(({ type, icon, label }) => (
              <button key={type} type="button"
                className={`log-type-btn${selectedType === type ? ' selected' : ''}`}
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
                  <video src={preview} controls
                    style={{ width: '100%', borderRadius: 8, maxHeight: 260, display: 'block' }} />
                ) : (
                  <img src={preview} alt="Preview"
                    style={{ width: '100%', borderRadius: 8, maxHeight: 260, objectFit: 'cover', display: 'block' }} />
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
        <h2 style={{ fontSize: '1rem', fontFamily: 'var(--font-ui)', fontWeight: 700, margin: 0 }}>Today so far</h2>
        {logs && <span className="badge badge-muted">{logs.length} {logs.length === 1 ? 'entry' : 'entries'}</span>}
      </div>

      {logsLoading ? (
        <div style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : !logs?.length ? (
        <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
          No entries yet today.
        </p>
      ) : (
        <>
          {logs.every((l) => l.ai_source) && (
            <AiBadge variant="header"
              reason={logs[0].ai_reason ?? 'All entries on this page were generated or assisted by AI.'} />
          )}
          <div className="scroll-list">
            {logs.map((log) => {
              const typeInfo = LOG_TYPES.find((t) => t.type === log.type)
              const isEditing = editingId === log.id

              if (isEditing) {
                return (
                  <div key={log.id} className="card card-sm" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div className="log-type-grid">
                      {LOG_TYPES.filter((t) => showMood || t.type !== 'mood').map(({ type, icon, label }) => (
                        <button key={type} type="button"
                          className={`log-type-btn${editType === type ? ' selected' : ''}`}
                          onClick={() => setEditType(type)}>
                          <span className="icon">{icon}</span>{label}
                        </button>
                      ))}
                    </div>
                    <textarea className="input" rows={2} value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      autoFocus style={{ resize: 'vertical' }} />
                    {showMood && (
                    <div>
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
                    )}
                    {updateLog.isError && (
                      <div className="alert alert-error" style={{ fontSize: '0.8rem' }}>
                        {updateLog.error instanceof Error ? updateLog.error.message : 'Could not save.'}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn-ghost" onClick={cancelEdit} style={{ flex: 1, fontSize: '0.85rem' }}>Cancel</button>
                      <button className="btn btn-primary"
                        onClick={() => updateLog.mutate({ id: log.id, label: editLabel, type: editType, moodScore: editMood })}
                        disabled={updateLog.isPending}
                        style={{ flex: 2, fontSize: '0.85rem' }}>
                        {updateLog.isPending ? <span className="spinner" /> : 'Save changes'}
                      </button>
                    </div>
                  </div>
                )
              }

              return (
                <div key={log.id} className="card card-sm"
                  style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', cursor: 'pointer' }}
                  onClick={() => startEdit(log)}>
                  <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{typeInfo?.icon ?? '📝'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 500 }}>{log.label}</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                      {new Date(log.occurred_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                      {' · '}
                      {typeInfo?.label ?? log.type}
                      {log.ai_source && log.ai_reason && (
                        <> · <AiBadge reason={log.ai_reason} /></>
                      )}
                    </p>
                    {showMood && <MoodBar score={log.mood_score} />}
                    {log.photo_path && <MediaCell path={log.photo_path} />}
                    <EntryReactions entryId={log.id} />
                    <EntryComments entryId={log.id} clientId={log.client_id} orgId={log.org_id} />
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', paddingTop: 2, flexShrink: 0 }}>✏️</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
