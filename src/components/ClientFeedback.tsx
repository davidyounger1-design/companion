import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { ClientFeedback as ClientFeedbackRow } from '../types/database'

type FeedbackWithAuthor = ClientFeedbackRow & { author_name?: string }

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return `Today · ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
  if (diffDays === 1) return `Yesterday · ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function ClientFeedback({
  clientId, orgId, placeholder = "Share anything you'd like the care team to know.",
}: { clientId: string; orgId: string; placeholder?: string }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const { data: feedback = [], isLoading } = useQuery({
    queryKey: ['client-feedback', clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_feedback')
        .select('*, profiles!author_id(full_name)')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((f: any) => ({ ...f, author_name: f.profiles?.full_name })) as FeedbackWithAuthor[]
    },
    enabled: !!clientId,
  })

  async function handleSubmit() {
    if (!body.trim() || !user) return
    setSubmitting(true)
    setError('')
    const { error: insertError } = await supabase.from('client_feedback').insert({
      client_id: clientId,
      org_id: orgId,
      author_id: user.id,
      body: body.trim(),
    })
    setSubmitting(false)
    if (insertError) { setError(insertError.message); return }
    setBody('')
    qc.invalidateQueries({ queryKey: ['client-feedback', clientId] })
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <p style={{ fontWeight: 500, marginBottom: '0.5rem', fontSize: '0.9375rem' }}>Leave feedback</p>
        <textarea
          className="input"
          rows={3}
          placeholder={placeholder}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ resize: 'vertical', marginBottom: '0.75rem' }}
        />
        {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</div>}
        <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || !body.trim()}>
          {submitting ? <span className="spinner" /> : 'Send feedback'}
        </button>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem 0' }}>
          <div className="spinner" style={{ width: 24, height: 24, color: 'var(--color-primary)' }} />
        </div>
      )}

      {!isLoading && feedback.length === 0 && (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', textAlign: 'center', padding: '1rem 0' }}>
          No feedback yet.
        </p>
      )}

      {feedback.map((f) => (
        <div key={f.id} className="card card-sm" style={{ marginBottom: '0.75rem' }}>
          <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{f.body}</p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--color-muted)' }}>
            {f.author_name ?? 'Someone'} · {formatDate(f.created_at)}
          </p>
        </div>
      ))}
    </div>
  )
}
