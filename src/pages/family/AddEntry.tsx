import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

type EntryType = 'meal' | 'activity' | 'mood' | 'note'

const TYPES: { key: EntryType; label: string; icon: string; prompt: string; placeholder: string }[] = [
  { key: 'meal',     label: 'Meal',     icon: '🍽️', prompt: 'What did they eat or drink?', placeholder: 'e.g. Porridge and orange juice' },
  { key: 'activity', label: 'Activity', icon: '🌿', prompt: 'What did they do?',            placeholder: 'e.g. Walked to the park' },
  { key: 'mood',     label: 'Mood',     icon: '😊', prompt: 'How were they feeling?',       placeholder: 'e.g. Happy and engaged' },
  { key: 'note',     label: 'Note',     icon: '📝', prompt: 'Note (optional if adding a photo)', placeholder: 'Add a note…' },
]

function fileExt(file: File) {
  return file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
}

export default function AddEntry() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<EntryType>('activity')
  const [label, setLabel] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const { data: clientRow } = useQuery({
    queryKey: ['family-client-id', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_family')
        .select('client_id')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return data
    },
    enabled: !!user,
  })

  const clientId = clientRow?.client_id

  function pickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  function removePhoto() {
    setPhoto(null)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSave() {
    if (!clientId || !profile?.org_id || !user) return
    if (!label.trim() && !photo) return
    setSaving(true)
    setError('')
    try {
      let photoPath: string | null = null
      if (photo) {
        const ext = fileExt(photo)
        const uuid = crypto.randomUUID()
        photoPath = `${profile.org_id}/${clientId}/${user.id}/${uuid}.${ext}`
        const { error: uploadErr } = await supabase.storage
          .from('journal-photos')
          .upload(photoPath, photo, { upsert: false })
        if (uploadErr) throw uploadErr
      }

      const { error: insertErr } = await supabase.from('log_entries').insert({
        client_id: clientId,
        org_id: profile.org_id,
        author_id: user.id,
        type,
        label: label.trim() || '📷',
        occurred_at: new Date().toISOString(),
        photo_path: photoPath,
      })
      if (insertErr) throw insertErr

      qc.invalidateQueries({ queryKey: ['family-journal', clientId] })
      navigate('/family')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save entry.')
    } finally {
      setSaving(false)
    }
  }

  const activeType = TYPES.find((t) => t.key === type)!
  const canSave = (label.trim().length > 0 || !!photo) && !!clientId

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-bg)', position: 'sticky', top: 0, zIndex: 10,
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
          {TYPES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setType(t.key)}
              style={{
                padding: '1rem',
                borderRadius: 12,
                border: `2px solid ${type === t.key ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: type === t.key ? 'var(--color-primary-subtle, #f0faf6)' : 'var(--color-surface)',
                cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem',
                fontSize: '0.875rem', fontWeight: type === t.key ? 600 : 400,
                color: type === t.key ? 'var(--color-primary-deep, #2d5a3d)' : 'var(--color-ink)',
                transition: 'border-color 0.15s',
              }}
            >
              <span style={{ fontSize: '1.5rem' }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Text field — optional for photo type */}
        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="entry-label">{activeType.prompt}</label>
          <textarea
            id="entry-label"
            className="input"
            placeholder={activeType.placeholder}
            rows={3}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ resize: 'vertical' }}
            autoFocus
          />
        </div>

        {/* Photo — always available, always optional (except photo-only entries) */}
        <input ref={fileRef} type="file" accept="image/*"
          style={{ display: 'none' }} onChange={pickPhoto} />

        {preview ? (
          <div style={{ position: 'relative', marginBottom: '1rem' }}>
            <img src={preview} alt="Preview"
              style={{ width: '100%', borderRadius: 8, maxHeight: 300, objectFit: 'cover', display: 'block' }} />
            <button onClick={removePhoto} style={{
              position: 'absolute', top: 8, right: 8,
              background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
              borderRadius: '50%', width: 28, height: 28, cursor: 'pointer',
              fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>✕</button>
          </div>
        ) : (
          <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} style={{
            width: '100%', border: '2px dashed var(--color-border)', borderRadius: 8,
            padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '0.5rem', color: 'var(--color-muted)', fontSize: '0.875rem',
          }}>
            <span style={{ fontSize: '1.25rem' }}>📷</span>
            Add a photo (optional)
          </button>
        )}
      </div>
    </div>
  )
}
