import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import MoodSlider from '../../components/MoodSlider'
import { createImageThumbnail, encryptFile, mimeFromPath } from '../../lib/photoEncryption'
import { useFeatures } from '../../hooks/useFeatures'
import { FEATURES } from '../../lib/features'

type EntryType = 'meal' | 'activity' | 'mood' | 'note'

const TYPES: { key: EntryType; label: string; icon: string; prompt: string; placeholder: string }[] = [
  { key: 'meal',     label: 'Meal',     icon: '🍽️', prompt: 'What did they eat or drink?', placeholder: 'e.g. Porridge and orange juice' },
  { key: 'activity', label: 'Activity', icon: '🌿', prompt: 'What did they do?',            placeholder: 'e.g. Walked to the park' },
  { key: 'mood',     label: 'Mood',     icon: '😊', prompt: 'How were they feeling?',       placeholder: 'e.g. Happy and engaged' },
  { key: 'note',     label: 'Note',     icon: '📝', prompt: 'Note (optional if adding media)', placeholder: 'Add a note…' },
]

function fileExt(file: File) {
  return file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
}

function isVideo(file: File) {
  return file.type.startsWith('video/')
}

export default function AddEntry() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const { has } = useFeatures()
  const showMood = has(FEATURES.moodTracking)
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<EntryType>('activity')
  const [label, setLabel] = useState('')
  const [media, setMedia] = useState<File[]>([])
  const [preview, setPreview] = useState<string[]>([])
  const [moodScore, setMoodScore] = useState(50)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { data: clientRow } = useQuery({
    queryKey: ['family-client-id', user?.id, profile?.role],
    queryFn: async () => {
      if (profile?.role === 'recipient') {
        const { data } = await supabase
          .from('clients')
          .select('id')
          .eq('recipient_profile_id', user!.id)
          .maybeSingle()
        return data ? { client_id: data.id } : null
      }
      const { data } = await supabase
        .from('client_family')
        .select('client_id')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return data
    },
    enabled: !!user && !!profile,
  })

  const clientId = clientRow?.client_id

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

  async function handleSave() {
    if (!clientId || !profile?.org_id || !user) return
    if (!label.trim() && !media.length) return
    setSaving(true)
    setError('')
    try {
      let firstPhotoPath: string | null = null
      let firstThumbPath: string | null = null
      const photoRows: Array<{ entry_id: string; photo_path: string; photo_thumb_path: string | null; sort_order: number }> = []

      if (media.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: keyHex, error: keyErr } = await (supabase.rpc as any)('get_or_create_photo_key')
        if (keyErr || !keyHex) throw keyErr ?? new Error('Could not get encryption key')

        for (let i = 0; i < media.length; i++) {
          const file = media[i]
          const ext = fileExt(file)
          const photoUuid = crypto.randomUUID()
          const photoPath = `${profile.org_id}/${clientId}/${user.id}/${photoUuid}.${ext}`
          const mimeType = file.type || mimeFromPath(file.name)
          const encryptedBlob = await encryptFile(file, keyHex)
          const { error: uploadErr } = await supabase.storage
            .from('journal-photos')
            .upload(photoPath, encryptedBlob, { upsert: false, contentType: mimeType })
          if (uploadErr) throw uploadErr

          if (i === 0) firstPhotoPath = photoPath

          // Thumbnail (best effort, images only)
          let photoThumbPath: string | null = null
          if (!isVideo(file)) {
            const thumbBlob = await createImageThumbnail(file)
            if (thumbBlob) {
              photoThumbPath = `${profile.org_id}/${clientId}/${user.id}/${photoUuid}-thumb.jpg`
              const encryptedThumb = await encryptFile(thumbBlob, keyHex)
              const { error: thumbErr } = await supabase.storage
                .from('journal-photos')
                .upload(photoThumbPath, encryptedThumb, { upsert: false, contentType: 'image/jpeg' })
              if (thumbErr) photoThumbPath = null
            }
          }
          if (i === 0) firstThumbPath = photoThumbPath

          photoRows.push({ entry_id: '', photo_path: photoPath, photo_thumb_path: photoThumbPath, sort_order: i })
        }
      }

      // Insert the log_entry (still set legacy columns for backward compat)
      const { data: entryData, error: insertErr } = await supabase.from('log_entries').insert({
        client_id: clientId,
        org_id: profile.org_id,
        author_id: user.id,
        type,
        label: label.trim() || (media.length > 0 && isVideo(media[0]) ? '🎥' : media.length > 0 ? '📷' : '📝'),
        occurred_at: new Date().toISOString(),
        photo_path: firstPhotoPath,
        photo_thumb_path: firstThumbPath,
        mood_score: moodScore,
      }).select('id').single()
      if (insertErr) throw insertErr

      // Insert log_entry_photos rows
      if (photoRows.length > 0 && entryData) {
        const rows = photoRows.map((r) => ({ ...r, entry_id: entryData.id }))
        const { error: photosErr } = await supabase.from('log_entry_photos').insert(rows)
        if (photosErr) throw photosErr
      }

      qc.invalidateQueries({ queryKey: ['family-journal', clientId] })
      navigate('/family')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save entry.')
    } finally {
      setSaving(false)
    }
  }

  const activeType = TYPES.find((t) => t.key === type)!
  const canSave = (label.trim().length > 0 || media.length > 0) && !!clientId

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg)', position: 'sticky', top: 'var(--family-header-h, 0px)', zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate('/family')}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>
          ← Cancel
        </button>
        <span style={{ fontWeight: 600, fontSize: '0.9375rem' }}>New entry</span>
        <button className="btn btn-primary" onClick={handleSave}
          disabled={!canSave || saving} style={{ fontSize: '0.875rem' }}>
          {saving ? <span className="spinner" /> : 'Save'}
        </button>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '1rem', flex: 1, width: '100%' }}>
        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {/* Type selector */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {TYPES.filter((t) => showMood || t.key !== 'mood').map((t) => (
            <button key={t.key} type="button" onClick={() => setType(t.key)} style={{
              padding: '1rem', borderRadius: 12,
              border: `2px solid ${type === t.key ? 'var(--color-primary)' : 'var(--color-border)'}`,
              background: type === t.key ? 'var(--color-primary-subtle, #f0faf6)' : 'var(--color-surface)',
              cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem',
              fontSize: '0.875rem', fontWeight: type === t.key ? 600 : 400,
              color: type === t.key ? 'var(--color-primary-deep, #2d5a3d)' : 'var(--color-ink)',
              transition: 'border-color 0.15s',
            }}>
              <span style={{ fontSize: '1.5rem' }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Text field */}
        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="entry-label">{activeType.prompt}</label>
          <textarea
            id="entry-label" className="input"
            placeholder={activeType.placeholder}
            rows={3} value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ resize: 'vertical' }} autoFocus
          />
        </div>

        {/* Mood slider */}
        {showMood && <MoodSlider value={moodScore} onChange={setMoodScore} />}

        {/* Media picker */}
        <input ref={fileRef} type="file" accept="image/*,video/*" multiple
          style={{ display: 'none' }} onChange={pickMedia} />

        {/* Media preview grid */}
        {preview.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
            {preview.map((url, i) => {
              const file = media[i]
              const isVid = file ? isVideo(file) : false
              return (
                <div key={url} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: 'var(--color-border)' }}>
                  {isVid ? (
                    <video src={url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  )}
                  <button onClick={() => removeMedia(i)} style={{
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

        <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} style={{
          width: '100%', border: '2px dashed var(--color-border)', borderRadius: 8,
          padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '0.5rem', color: 'var(--color-muted)', fontSize: '0.875rem', marginBottom: '1rem',
        }}>
          <span style={{ fontSize: '1.25rem' }}>📷</span>
          Add a photo or video (optional)
        </button>
      </div>
    </div>
  )
}
