import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { LogEntryComment } from '../types/database'

type CommentWithAuthor = LogEntryComment & { author_name?: string }

function formatCommentTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function EntryComments({
  entryId, clientId, orgId,
}: { entryId: string; clientId: string; orgId: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const { data: comments = [], isLoading } = useQuery({
    queryKey: ['entry-comments', entryId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('log_entry_comments')
        .select('*, profiles!author_id(full_name)')
        .eq('entry_id', entryId)
        .order('created_at', { ascending: true })
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((c: any) => ({ ...c, author_name: c.profiles?.full_name })) as CommentWithAuthor[]
    },
    enabled: expanded,
  })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim() || !user) return
    setSubmitting(true)
    setError('')
    const { error: insertError } = await supabase.from('log_entry_comments').insert({
      entry_id: entryId,
      client_id: clientId,
      org_id: orgId,
      author_id: user.id,
      body: body.trim(),
    })
    setSubmitting(false)
    if (insertError) { setError(insertError.message); return }
    setBody('')
    qc.invalidateQueries({ queryKey: ['entry-comments', entryId] })
  }

  return (
    <div style={{ marginTop: '0.5rem' }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontSize: '0.75rem', color: 'var(--color-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem',
        }}
      >
        💬 {expanded ? 'Hide comments' : comments.length > 0 ? `Comments (${comments.length})` : 'Comment'}
      </button>

      {expanded && (
        <div style={{ marginTop: '0.5rem', paddingLeft: '0.5rem', borderLeft: '2px solid var(--color-border)' }}>
          {isLoading && (
            <div style={{ padding: '0.5rem 0' }}>
              <span className="spinner" style={{ width: 16, height: 16 }} />
            </div>
          )}
          {!isLoading && comments.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: '0.25rem 0 0.5rem' }}>No comments yet.</p>
          )}
          {comments.map((c) => (
            <div key={c.id} style={{ margin: '0.4rem 0' }}>
              <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>{c.body}</p>
              <p style={{ margin: '0.1rem 0 0', fontSize: '0.68rem', color: 'var(--color-muted)' }}>
                {c.author_name ?? 'Someone'} · {formatCommentTime(c.created_at)}
              </p>
            </div>
          ))}
          <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
            <input
              className="input"
              placeholder="Add a comment…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}
            />
            <button type="submit" className="btn btn-ghost" disabled={submitting || !body.trim()}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.6rem', flexShrink: 0 }}>
              {submitting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Post'}
            </button>
          </form>
          {error && <div className="alert alert-error" style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
