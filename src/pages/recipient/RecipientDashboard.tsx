import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { signOut } from '../../lib/auth'
import type { ClientFeedback } from '../../types/database'

function formatDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return `Today · ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
  if (diffDays === 1) return `Yesterday · ${d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function RecipientDashboard() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const { data: client, isLoading: clientLoading } = useQuery({
    queryKey: ['recipient-client', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('id, org_id, full_name')
        .eq('recipient_profile_id', user!.id)
        .maybeSingle()
      return data
    },
    enabled: !!user,
  })

  const { data: feedback = [], isLoading: feedbackLoading } = useQuery({
    queryKey: ['client-feedback', client?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_feedback')
        .select('*')
        .eq('client_id', client!.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as ClientFeedback[]
    },
    enabled: !!client?.id,
  })

  async function handleSubmit() {
    if (!body.trim() || !client) return
    setSubmitting(true)
    setError('')
    const { error: insertError } = await supabase.from('client_feedback').insert({
      client_id: client.id,
      org_id: client.org_id,
      author_id: user!.id,
      body: body.trim(),
    })
    setSubmitting(false)
    if (insertError) { setError(insertError.message); return }
    setBody('')
    qc.invalidateQueries({ queryKey: ['client-feedback', client.id] })
  }

  async function handleSignOut() {
    await signOut()
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
        padding: '0.875rem 1.25rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600 }}>Companion</span>
          <span className="badge badge-sage" style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>Recipient</span>
        </div>
        <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}>
          Sign out
        </button>
      </header>

      <div style={{ maxWidth: 640, margin: '0 auto', padding: '1rem' }}>
        <p className="eyebrow" style={{ margin: '0 0 0.25rem' }}>Your feedback</p>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: '0 0 1rem' }}>
          {client?.full_name ? `Hi, ${client.full_name.split(' ')[0]}` : 'Hi'}
        </h1>

        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 500, marginBottom: '0.5rem', fontSize: '0.9375rem' }}>Leave feedback</p>
          <textarea
            className="input"
            rows={3}
            placeholder="How are things going? Share anything you'd like your care team to know."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            style={{ resize: 'vertical', marginBottom: '0.75rem' }}
          />
          {error && <div className="alert alert-error" style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}>{error}</div>}
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !body.trim() || !client}
          >
            {submitting ? <span className="spinner" /> : 'Send feedback'}
          </button>
        </div>

        {(clientLoading || feedbackLoading) && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
            <div className="spinner" style={{ width: 28, height: 28, color: 'var(--color-primary)' }} />
          </div>
        )}

        {!clientLoading && !client && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--color-muted)' }}>
            <p>We couldn't find a linked care record for your account. Ask your coordinator or family contact for help.</p>
          </div>
        )}

        {!feedbackLoading && client && feedback.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--color-muted)' }}>
            <p style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>📝</p>
            <p>You haven't left any feedback yet.</p>
          </div>
        )}

        {feedback.map((f) => (
          <div key={f.id} className="card card-sm" style={{ marginBottom: '0.75rem' }}>
            <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{f.body}</p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.72rem', color: 'var(--color-muted)' }}>
              {formatDate(f.created_at)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
