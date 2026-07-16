import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function WorkerNoticeBoard() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const [newBody, setNewBody] = useState('')
  const [posting, setPosting] = useState(false)
  const isCoordinator = profile?.role === 'coordinator'

  // Find first client for worker context
  const { data: firstClientId } = useQuery({
    queryKey: ['worker-first-client', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_workers')
        .select('client_id')
        .eq('worker_id', user!.id)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
      return data?.client_id ?? null
    },
    enabled: !!user,
  })

  const { data: notices = [], isLoading } = useQuery({
    queryKey: ['notices', profile?.org_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notices')
        .select('*, profiles!author_id(full_name)')
        .eq('org_id', profile!.org_id!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
    enabled: !!profile?.org_id,
  })

  async function postNotice() {
    if (!newBody.trim() || !user || !profile?.org_id || !firstClientId) return
    setPosting(true)
    try {
      await supabase.from('notices').insert({
        org_id: profile.org_id,
        client_id: firstClientId,
        author_id: user.id,
        body: newBody.trim(),
      })
      setNewBody('')
      qc.invalidateQueries({ queryKey: ['notices', profile.org_id] })
    } finally {
      setPosting(false)
    }
  }

  async function deleteNotice(id: string) {
    await supabase.from('notices').delete().eq('id', id)
    qc.invalidateQueries({ queryKey: ['notices', profile?.org_id] })
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate('/worker')}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>📌 Notice Board</h1>
      </div>

      <div style={{ maxWidth: 520, margin: '0 auto', padding: '1rem' }}>
        {/* Post a notice — coordinator-only */}
        {isCoordinator && (
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: '0.875rem' }}>Post a notice</p>
            <textarea className="input" rows={3} value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="e.g. No appointments this Friday — public holiday"
              style={{ resize: 'vertical', marginBottom: '0.75rem' }} />
            <button className="btn btn-primary" onClick={postNotice}
              disabled={posting || !newBody.trim() || !firstClientId}
              style={{ fontSize: '0.875rem' }}>
              {posting ? <span className="spinner" /> : 'Post notice'}
            </button>
            {!firstClientId && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
                No active client assignment found.
              </p>
            )}
          </div>
        )}

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <div className="spinner" style={{ color: 'var(--color-primary)' }} />
          </div>
        )}

        {!isLoading && notices.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-muted)' }}>
            <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📌</p>
            <p>No notices yet.</p>
          </div>
        )}

        {notices.map((n: any) => (
          <div key={n.id} style={{
            background: '#fff8e1', border: '2px solid #ffc107', borderRadius: 12,
            padding: '0.875rem 1rem', marginBottom: '0.75rem', position: 'relative',
          }}>
            <p style={{ margin: '0 1.5rem 0.4rem 0', fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.5 }}>
              {n.body}
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
      </div>
    </div>
  )
}
