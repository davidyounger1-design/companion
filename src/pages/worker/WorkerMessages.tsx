import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

export default function WorkerMessages() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Find the coordinator for this org
  const { data: coordinator } = useQuery({
    queryKey: ['coordinator', profile?.org_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('org_id', profile!.org_id!)
        .eq('role', 'coordinator')
        .maybeSingle()
      return data
    },
    enabled: !!profile?.org_id,
  })

  // Find first client for this worker (needed for messages)
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

  const { data: messages = [] } = useQuery({
    queryKey: ['worker-messages', user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('messages')
        .select('*, sender:profiles!sender_id(full_name)')
        .eq('org_id', profile!.org_id!)
        .or(`sender_id.eq.${user!.id},recipient_id.eq.${user!.id}`)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data ?? []
    },
    enabled: !!user && !!profile?.org_id,
    refetchInterval: 10000,
  })

  // Mark as seen
  useEffect(() => {
    if (!user) return
    localStorage.setItem(`msg_last_seen_${user.id}`, new Date().toISOString())
    qc.invalidateQueries({ queryKey: ['unread-count'] })
  }, [messages.length, user, qc])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Realtime subscription
  useEffect(() => {
    if (!profile?.org_id || !user) return
    const channel = supabase
      .channel('worker-msgs')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'companion', table: 'messages',
        filter: `org_id=eq.${profile.org_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['worker-messages', user.id] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.org_id, user, qc])

  async function send() {
    if (!body.trim() || !user || !profile?.org_id || !coordinator || !firstClientId) return
    setSending(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('messages') as any).insert({
        org_id: profile.org_id,
        client_id: firstClientId,
        sender_id: user.id,
        recipient_id: coordinator.id,
        body: body.trim(),
      })
      setBody('')
      qc.invalidateQueries({ queryKey: ['worker-messages', user.id] })
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--color-bg)' }}>
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate('/worker')}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9375rem' }}>Messages</p>
          {coordinator && (
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-muted)' }}>
              With {coordinator.full_name}
            </p>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-muted)' }}>
            <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>💬</p>
            <p>No messages yet. Start a conversation with your coordinator.</p>
          </div>
        )}
        {messages.map((msg: any) => {
          const isMe = msg.sender_id === user?.id
          return (
            <div key={msg.id} style={{
              display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '75%', padding: '0.625rem 0.875rem', borderRadius: 16,
                borderBottomRightRadius: isMe ? 4 : 16, borderBottomLeftRadius: isMe ? 16 : 4,
                background: isMe ? 'var(--color-primary)' : 'var(--color-surface)',
                color: isMe ? '#fff' : 'var(--color-ink)',
                border: isMe ? 'none' : '1px solid var(--color-border)',
              }}>
                <p style={{ margin: 0, fontSize: '0.9375rem', lineHeight: 1.5 }}>{msg.body}</p>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.7rem', opacity: 0.7, textAlign: isMe ? 'right' : 'left' }}>
                  {formatTime(msg.created_at)}
                </p>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{
        padding: '0.75rem 1rem', borderTop: '1px solid var(--color-border)',
        background: 'var(--color-bg)', display: 'flex', gap: '0.5rem', alignItems: 'flex-end',
      }}>
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Message your coordinator…"
          rows={1} style={{
            flex: 1, resize: 'none', padding: '0.625rem 0.875rem', fontSize: '0.9375rem',
            border: '1px solid var(--color-border)', borderRadius: 20, outline: 'none',
            fontFamily: 'inherit', background: 'var(--color-surface)',
          }}
        />
        <button onClick={send} disabled={!body.trim() || sending || !coordinator}
          className="btn btn-primary" style={{ borderRadius: '50%', width: 40, height: 40, padding: 0, fontSize: '1rem', flexShrink: 0 }}>
          {sending ? <span className="spinner" style={{ width: 16, height: 16 }} /> : '↑'}
        </button>
      </div>
    </div>
  )
}
