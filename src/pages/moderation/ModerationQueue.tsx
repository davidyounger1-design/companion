import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { errorMessage } from '../../lib/errorMessage'
import { roleHome } from '../../lib/roleHome'
import Lightbox from '../../components/Lightbox'
import type { LogType, LogEntryStatus } from '../../types/database'

const LOG_TYPES: { type: LogType; icon: string; label: string }[] = [
  { type: 'meal',     icon: '🍽️', label: 'Meal' },
  { type: 'activity', icon: '🌿', label: 'Activity' },
  { type: 'mood',     icon: '😊', label: 'Mood' },
  { type: 'note',     icon: '📝', label: 'Note' },
]

function isVideoPath(path: string) {
  return /\.(mp4|mov|webm|m4v|avi|ogv)(\?|$)/i.test(path)
}

// Org-wide queue: entries needing a moderator's attention (awaiting review,
// or previously hidden and possibly worth restoring). Released entries
// aren't shown here — this is a work queue, not a full journal browser;
// day-to-day journal viewing stays on the existing client-detail pages.
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

const STATUS_BADGE: Record<Exclude<LogEntryStatus, 'released'>, { label: string; bg: string; color: string }> = {
  pending: { label: 'Awaiting review', bg: '#fff3cd', color: '#856404' },
  hidden:  { label: 'Hidden',          bg: '#f8d7da', color: '#721c24' },
}

export default function ModerationQueue() {
  const navigate = useNavigate()
  const { profile, org } = useAuth()
  const qc = useQueryClient()
  const [error, setError] = useState('')

  const { data: entries, isLoading } = useQuery({
    queryKey: ['moderation-queue', profile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('log_entries')
        .select('*')
        .eq('org_id', profile!.org_id!)
        .in('status', ['pending', 'hidden'])
        .order('occurred_at', { ascending: false })
      if (error) throw error
      return data
    },
    enabled: !!profile?.org_id,
  })

  const clientIds = [...new Set((entries ?? []).map((e) => e.client_id))]
  const { data: clientMap = {} } = useQuery({
    queryKey: ['moderation-client-names', clientIds.sort().join(',')],
    queryFn: async () => {
      if (!clientIds.length) return {} as Record<string, string>
      const { data } = await supabase.from('clients').select('id, full_name').in('id', clientIds)
      const map: Record<string, string> = {}
      for (const c of data ?? []) map[c.id] = c.full_name
      return map
    },
    enabled: clientIds.length > 0,
    staleTime: 60_000,
  })

  const authorIds = [...new Set((entries ?? []).map((e) => e.author_id))]
  const { data: authorMap = {} } = useQuery({
    queryKey: ['moderation-author-names', authorIds.sort().join(',')],
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

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: LogEntryStatus }) => {
      const { error } = await supabase.from('log_entries').update({ status }).eq('id', id)
      if (error) throw error
    },
    onError: (err) => setError(errorMessage(err, 'Could not update this entry.')),
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: ['moderation-queue'] })
    },
  })

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={{
        padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate(roleHome(profile?.role, org?.org_type))}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <div>
          <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>🛡️ Moderation queue</h1>
          <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-muted)' }}>
            Entries awaiting review, org-wide
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '1rem' }}>
        {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '3rem' }}>
            <div className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
          </div>
        ) : !entries?.length ? (
          <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', textAlign: 'center', padding: '1.5rem' }}>
            Nothing needs review right now.
          </p>
        ) : (
          <div className="scroll-list">
            {entries.map((log) => {
              const typeInfo = LOG_TYPES.find((t) => t.type === log.type)
              const badge = log.status === 'released' ? null : STATUS_BADGE[log.status]
              const busy = setStatus.isPending && setStatus.variables?.id === log.id
              return (
                <div key={log.id} className="card card-sm" style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{typeInfo?.icon ?? '📝'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 500 }}>
                      {log.label}
                      {badge && (
                        <span style={{ marginLeft: '0.4rem', fontSize: '0.68rem', fontWeight: 600, padding: '0.1rem 0.4rem', borderRadius: 4, background: badge.bg, color: badge.color }}>
                          {badge.label}
                        </span>
                      )}
                    </p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' }}>
                      {clientMap[log.client_id] ?? '…'}
                      {' · '}
                      {new Date(log.occurred_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' · '}
                      {typeInfo?.label ?? log.type}
                      {authorMap[log.author_id] && <> · {authorMap[log.author_id]}</>}
                    </p>
                    <MediaCell entryId={log.id} legacyPath={log.photo_path} />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                      <button className="btn btn-primary" style={{ fontSize: '0.8rem', flex: 1 }}
                        disabled={busy}
                        onClick={() => setStatus.mutate({ id: log.id, status: 'released' })}>
                        {busy && setStatus.variables?.status === 'released' ? <span className="spinner" /> : 'Release'}
                      </button>
                      {log.status !== 'hidden' && (
                        <button className="btn btn-ghost" style={{ fontSize: '0.8rem', flex: 1 }}
                          disabled={busy}
                          onClick={() => setStatus.mutate({ id: log.id, status: 'hidden' })}>
                          {busy && setStatus.variables?.status === 'hidden' ? <span className="spinner" /> : 'Hide'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
