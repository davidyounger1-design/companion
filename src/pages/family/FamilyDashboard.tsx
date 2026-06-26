import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import type { LogEntry } from '../../types/database'

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

const TYPE_ICON: Record<string, string> = {
  meal: '🍽️',
  activity: '🌿',
  mood: '😊',
  note: '📝',
  photo: '📷',
}

function PhotoEntry({ path }: { path: string }) {
  const { data: url } = useQuery({
    queryKey: ['photo-url', path],
    queryFn: async () => {
      const { data } = await supabase.storage
        .from('journal-photos')
        .createSignedUrl(path, 3600)
      return data?.signedUrl ?? null
    },
    staleTime: 3_500_000,
  })

  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      style={{
        width: '100%',
        borderRadius: 8,
        marginTop: '0.75rem',
        maxHeight: 320,
        objectFit: 'cover',
        display: 'block',
      }}
    />
  )
}

type EntryWithAuthor = LogEntry & { author_name?: string }

function EntryCard({ entry, showAuthor }: { entry: EntryWithAuthor; showAuthor: boolean }) {
  return (
    <div className="card" style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flex: 1 }}>
          <span style={{ fontSize: '1.1rem', marginTop: 2 }}>{TYPE_ICON[entry.type] ?? '📝'}</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.5 }}>{entry.label}</p>
            {showAuthor && entry.author_name && (
              <p style={{ margin: '0.2rem 0 0', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                {entry.author_name}
              </p>
            )}
          </div>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', whiteSpace: 'nowrap', marginLeft: '0.75rem' }}>
          {formatTime(entry.occurred_at)}
        </span>
      </div>
      {entry.photo_path && <PhotoEntry path={entry.photo_path} />}
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

  async function handleSignOut() {
    await supabase.auth.signOut()
    // RequireAuth will redirect to /sign-in once AuthContext clears the session
  }
  const isCoordinator = profile?.role === 'coordinator'

  const [editMode, setEditMode] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDob, setEditDob] = useState('')
  const [saving, setSaving] = useState(false)

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
    qc.invalidateQueries({ queryKey: ['family-client-id'] })
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
        .limit(100)
      if (error) throw error
      return data as LogEntry[]
    },
    enabled: !!clientId,
  })

  // Fetch author names in a single batch (coordinators/family see entries from multiple people)
  const authorIds = [...new Set(entries.map((e) => e.author_id))]
  const { data: authorMap = {} } = useQuery({
    queryKey: ['author-names', authorIds.sort().join(',')],
    queryFn: async () => {
      if (!authorIds.length) return {}
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', authorIds)
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

  return (
    <div style={{
      minHeight: '100dvh',
      background: 'var(--color-bg)',
      paddingBottom: '5rem',
    }}>
      {/* Header */}
      <div style={{
        padding: '1rem 1rem 0',
        position: 'sticky', top: 0,
        background: 'var(--color-bg)',
        zIndex: 10,
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div style={{
          maxWidth: 520,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: '0.75rem',
        }}>
          {editMode ? (
            /* ── inline edit mode ── */
            <div style={{ flex: 1 }}>
              <p className="eyebrow" style={{ margin: '0 0 0.4rem' }}>Edit participant</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  className="input"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Full name"
                  autoFocus
                  style={{ fontSize: '0.9rem', minHeight: 36, padding: '0.4rem 0.75rem', width: 160 }}
                />
                <input
                  type="date"
                  className="input"
                  value={editDob}
                  onChange={(e) => setEditDob(e.target.value)}
                  style={{ fontSize: '0.9rem', minHeight: 36, padding: '0.4rem 0.75rem', width: 150 }}
                />
                <button
                  className="btn btn-primary"
                  onClick={saveEdit}
                  disabled={saving || !editName.trim()}
                  style={{ fontSize: '0.85rem', minHeight: 36, padding: '0.4rem 1rem' }}
                >
                  {saving ? <span className="spinner" /> : 'Save'}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setEditMode(false)}
                  style={{ fontSize: '0.85rem', minHeight: 36, padding: '0.4rem 0.75rem' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            /* ── normal view ── */
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div>
                  <p className="eyebrow" style={{ margin: 0 }}>Care journal</p>
                  <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>{participantName}</h1>
                </div>
                {isCoordinator && (
                  <button
                    className="btn btn-ghost"
                    onClick={startEdit}
                    style={{ fontSize: '1rem', padding: '0.2rem 0.4rem', lineHeight: 1 }}
                    title="Edit participant details"
                  >
                    ✏️
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {isCoordinator && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => navigate('/members')}
                    style={{ fontSize: '0.875rem' }}
                  >
                    Members
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={() => navigate('/family/add')}
                  style={{ fontSize: '0.875rem' }}
                >
                  + Add entry
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                  <button
                    className="btn btn-ghost"
                    onClick={handleSignOut}
                    style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}
                  >
                    Sign out
                  </button>
                  {(currentUserName || user?.email) && (
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', paddingRight: '0.5rem', textAlign: 'right', lineHeight: 1.4 }}>
                      {currentUserName && <>{currentUserName}<br /></>}
                      {user?.email}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 520, margin: '0 auto', padding: '1rem' }}>
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

        {grouped.map(([date, dayEntries]) => (
          <div key={date}>
            <p style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--color-muted)',
              margin: '1.25rem 0 0.5rem',
            }}>
              {date}
            </p>
            {dayEntries.map((e) => <EntryCard key={e.id} entry={e} showAuthor={true} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
