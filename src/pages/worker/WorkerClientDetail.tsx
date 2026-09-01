import { useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import AiBadge from '../../components/AiBadge'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errorMessage'
import { useAuth } from '../../context/AuthContext'
import MoodSlider from '../../components/MoodSlider'
import { MoodBar, moodColor, moodEmoji } from '../../components/MoodSlider'
import { useFeatures } from '../../hooks/useFeatures'
import { usePermissions } from '../../hooks/usePermissions'
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
import MedicationList from '../../components/MedicationList'
import { useOrgFeatureFlags } from '../../hooks/useOrgFeatureFlags'
import { QUICK_PICKS, formatDuration } from '../../lib/timer'
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

function MediaCell({ entryId, legacyPath }: { entryId: string; legacyPath?: string | null }) {
  const [lightbox, setLightbox] = useState<{ srcs: string[]; index: number } | null>(null)
  const { data: photos } = useQuery({
    queryKey: ['entry-photos', entryId],
    queryFn: async () => {
      const { data } = await supabase
        .from('log_entry_photos')
        .select('*')
        .eq('entry_id', entryId)
        .order('sort_order', { ascending: true })
      if (data && data.length > 0) return data as Array<{ photo_path: string; photo_thumb_path: string | null }>
      // Fallback to legacy single photo
      if (legacyPath) return [{ photo_path: legacyPath, photo_thumb_path: null }]
      return []
    },
    staleTime: 3_500_000,
    enabled: !!entryId,
  })
  const { data: signedUrls } = useQuery({
    queryKey: ['entry-photo-urls', entryId, photos],
    queryFn: async () => {
      if (!photos?.length) return []
      const results = await Promise.all(
        photos.map((p) =>
          supabase.storage.from('journal-photos').createSignedUrl(p.photo_path, 3600)
            .then(({ data }) => data?.signedUrl ?? null)
        ),
      )
      return results.filter(Boolean) as string[]
    },
    staleTime: 3_500_000,
    enabled: !!photos?.length,
  })
  if (!photos?.length || !signedUrls?.length) return null
  const maxVisible = 4
  const visible = signedUrls.slice(0, maxVisible)
  const more = signedUrls.length - maxVisible
  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${Math.min(visible.length, 2)}, 1fr)`,
        gap: '0.35rem', marginTop: '0.5rem',
      }}>
        {visible.map((url, i) => (
          <div key={url} style={{ position: 'relative', aspectRatio: '1', borderRadius: 6, overflow: 'hidden', cursor: 'zoom-in', background: 'var(--color-border)' }}
            onClick={() => setLightbox({ srcs: signedUrls, index: i })}>
            {isVideoPath(photos[i]?.photo_path ?? '') ? (
              <video src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            )}
            {i === maxVisible - 1 && more > 0 && (
              <div style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: '0.9rem', fontWeight: 700,
              }}>+{more}</div>
            )}
          </div>
        ))}
      </div>
      {lightbox && (
        <Lightbox srcs={lightbox.srcs} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />
      )}
    </>
  )
}

export default function WorkerClientDetail() {
  const { clientId } = useParams<{ clientId: string }>()
  const { user, profile } = useAuth()
  const perms = usePermissions()
  const { has } = useFeatures()
  const showMood = has(FEATURES.moodTracking)
  const showBehaviourNotesFeature = has(FEATURES.behaviourNotes)
  const showIncidentWorkflows = has(FEATURES.incidentWorkflows)
  const showNdisRecords = has(FEATURES.ndisRecords)
  const { isEnabled: orgEnabled } = useOrgFeatureFlags()
  const showMedicationTracking = has(FEATURES.medicationTracking) && orgEnabled('medication_tracking')
  const [showMedications, setShowMedications] = useState(false)
  const [showTimer, setShowTimer] = useState(false)
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

  const [media, setMedia] = useState<File[]>([])
  const [preview, setPreview] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  function pickMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setMedia((prev) => [...prev, ...files])
    setPreview((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))])
  }

  function removeMedia(index: number) {
    setMedia((prev) => prev.filter((_, i) => i !== index))
    setPreview((prev) => {
      const url = prev[index]
      if (url) URL.revokeObjectURL(url)
      return prev.filter((_, i) => i !== index)
    })
  }

  function resetForm() {
    setShowForm(false)
    preview.forEach((url) => URL.revokeObjectURL(url))
    setMedia([])
    setPreview([])
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
    mutationFn: async ({ label, mediaFiles }: { label: string; mediaFiles: File[] }) => {
      let firstPhotoPath: string | null = null
      const photoRows: Array<{ entry_id: string; photo_path: string; photo_thumb_path: string | null; sort_order: number }> = []
      for (let i = 0; i < mediaFiles.length; i++) {
        const file = mediaFiles[i]
        const ext = fileExt(file)
        const fileUuid = crypto.randomUUID()
        const photoPath = `${profile!.org_id}/${clientId}/${user!.id}/${fileUuid}.${ext}`
        if (i === 0) firstPhotoPath = photoPath
        const { error: uploadErr } = await supabase.storage
          .from('journal-photos')
          .upload(photoPath, file, { upsert: false })
        if (uploadErr) throw uploadErr
        photoRows.push({ entry_id: '', photo_path: photoPath, photo_thumb_path: null, sort_order: i })
      }
      const { data: entryData, error } = await supabase.from('log_entries').insert({
        client_id: clientId!,
        org_id: profile!.org_id!,
        author_id: user!.id,
        type: selectedType,
        label: label.trim() || (mediaFiles.length > 0 && isVideoFile(mediaFiles[0]) ? '🎥' : mediaFiles.length > 0 ? '📷' : '📝'),
        occurred_at: new Date().toISOString(),
        photo_path: firstPhotoPath,
        mood_score: newMood,
      }).select('id').single()
      if (error) throw error
      if (photoRows.length > 0 && entryData) {
        const rows = photoRows.map((r) => ({ ...r, entry_id: entryData.id }))
        const { error: photosErr } = await supabase.from('log_entry_photos').insert(rows)
        if (photosErr) throw photosErr
      }
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
            <BehaviourNotesSection clientId={client.id} />
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
            <NdisRecordsSection clientId={client.id} orgId={client.org_id} authorId={user!.id} canManageAny={perms.edit_any_goal} />
          </div>
        )}
      </div>}

      {showMedicationTracking && <div className="card" style={{ marginBottom: '1.25rem', padding: '0.875rem 1rem' }}>
        <button
          onClick={() => setShowMedications((x) => !x)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left', fontSize: '0.9375rem', fontWeight: 500,
          }}
        >
          💊 Medications for {client.full_name}
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{showMedications ? '▲' : '▼'}</span>
        </button>
        {showMedications && (
          <div style={{ marginTop: '0.875rem' }}>
            <MedicationList clientId={client.id} orgId={client.org_id} canManage={false} />
          </div>
        )}
      </div>}

      <div className="card" style={{ marginBottom: '1.25rem', padding: '0.875rem 1rem' }}>
        <button
          onClick={() => setShowTimer((x) => !x)}
          style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            width: '100%', background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left', fontSize: '0.9375rem', fontWeight: 500,
          }}
        >
          ⏱️ Timer for {client.full_name}
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{showTimer ? '▲' : '▼'}</span>
        </button>
        {showTimer && (
          <div style={{ marginTop: '0.875rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
              Start a countdown timer — it will appear on the recipient's screen.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {QUICK_PICKS.map((mins) => (
                <button key={mins} className="btn btn-ghost"
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                  onClick={async () => {
                    const endsAt = new Date(Date.now() + mins * 60_000).toISOString()
                    const { error } = await supabase.from('active_timers').upsert({
                      client_id: client.id,
                      org_id: client.org_id,
                      created_by: user!.id,
                      label: `${mins} min timer`,
                      ends_at: endsAt,
                    }, { onConflict: 'client_id' })
                    if (!error) {
                      qc.invalidateQueries({ queryKey: ['active-timer', client.id] })
                      setSuccessMsg(`Timer started — ${formatDuration(mins * 60)}`)
                      setTimeout(() => setSuccessMsg(''), 3000)
                    }
                  }}
                >{formatDuration(mins * 60)}</button>
              ))}
              <button className="btn btn-ghost" style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', color: 'var(--color-error)' }}
                onClick={async () => {
                  const { error } = await supabase.from('active_timers').delete().eq('client_id', client.id)
                  if (!error) {
                    qc.invalidateQueries({ queryKey: ['active-timer', client.id] })
                    setSuccessMsg('Timer cancelled.')
                    setTimeout(() => setSuccessMsg(''), 3000)
                  }
                }}
              >Cancel</button>
            </div>
          </div>
        )}
      </div>

      {successMsg && (
        <div className="alert alert-success" style={{ marginBottom: '1rem' }}>{successMsg}</div>
      )}

      {!perms.add_entries ? (
        <div className="card" style={{ marginBottom: '1.5rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.85rem' }}>
          Your coordinator has turned off adding journal entries for your role.
        </div>
      ) : !showForm ? (
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
            if (!d.label.trim() && !media.length) return
            addLog.mutate({ label: d.label, mediaFiles: media })
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

            <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={pickMedia} />
            {preview.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '0.5rem' }}>
                {preview.map((url, i) => {
                  const file = media[i]
                  const isVid = file ? isVideoFile(file) : false
                  return (
                    <div key={url} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'var(--color-border)' }}>
                      {isVid ? (
                        <video src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      <button type="button" onClick={() => removeMedia(i)} style={{
                        position: 'absolute', top: 2, right: 2,
                        background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
                        borderRadius: '50%', width: 22, height: 22, cursor: 'pointer',
                        fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>✕</button>
                    </div>
                  )
                })}
              </div>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} style={{
              width: '100%', border: '2px dashed var(--color-border)', borderRadius: 8,
              padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '0.5rem', color: 'var(--color-muted)', fontSize: '0.875rem',
            }}>
              <span style={{ fontSize: '1.1rem' }}>📷</span>
              Add a photo or video (optional)
            </button>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button type="button" className="btn btn-ghost" onClick={resetForm} style={{ flex: 1 }}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={addLog.isPending} style={{ flex: 2 }}>
                {addLog.isPending ? <span className="spinner" /> : 'Save entry'}
              </button>
            </div>

            {addLog.isError && (
              <div className="alert alert-error">
                {errorMessage(addLog.error, 'Could not save. Try again.')}
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
                        {errorMessage(updateLog.error, 'Could not save.')}
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
                  style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', cursor: perms.edit_own_entry ? 'pointer' : 'default' }}
                  onClick={perms.edit_own_entry ? () => startEdit(log) : undefined}>
                  <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{typeInfo?.icon ?? '📝'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 500 }}>
                      {log.label}
                      {log.status === 'pending' && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: 4, background: '#fff3cd', color: '#856404' }}>
                          Awaiting review
                        </span>
                      )}
                      {log.status === 'hidden' && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: 4, background: '#f8d7da', color: '#721c24' }}>
                          Hidden
                        </span>
                      )}
                    </p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                      {new Date(log.occurred_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                      {' · '}
                      {typeInfo?.label ?? log.type}
                      {log.ai_source && log.ai_reason && (
                        <> · <AiBadge reason={log.ai_reason} /></>
                      )}
                    </p>
                    {showMood && <MoodBar score={log.mood_score} />}
                    <MediaCell entryId={log.id} legacyPath={log.photo_path} />
                    <EntryReactions entryId={log.id} />
                    <EntryComments entryId={log.id} clientId={log.client_id} orgId={log.org_id} />
                  </div>
                  {perms.edit_own_entry && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', paddingTop: 2, flexShrink: 0 }}>✏️</span>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
