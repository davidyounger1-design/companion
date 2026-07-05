import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import FamilyStickyHeader from '../../components/FamilyStickyHeader'

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
}

const ROLE_LABEL: Record<string, string> = {
  coordinator: 'Coordinator',
  family: 'Family',
  trusted_support_worker: 'Trusted worker',
  support_worker: 'Support worker',
  therapist: 'Therapist',
}

export default function MessageThread() {
  const { userId } = useParams<{ userId: string }>()
  const isGroup = userId === 'group'
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Fetch a client_id to attach to each message (required by DB schema).
  // Try the user's own linked client first, then fall back to any org client.
  const { data: clientId } = useQuery({
    queryKey: ['msg-client-id', user?.id, profile?.org_id],
    queryFn: async () => {
      if (profile?.role === 'family' || profile?.role === 'coordinator') {
        const { data: cf } = await supabase
          .from('client_family')
          .select('client_id')
          .eq('family_id', user!.id)
          .eq('status', 'active')
          .maybeSingle()
        if (cf?.client_id) return cf.client_id
      } else {
        const { data: cw } = await supabase
          .from('client_workers')
          .select('client_id')
          .eq('worker_id', user!.id)
          .maybeSingle()
        if (cw?.client_id) return cw.client_id
      }
      // Fallback: any active client in the org
      const { data: c } = await (supabase as any)
        .from('clients')
        .select('id')
        .eq('org_id', profile!.org_id!)
        .limit(1)
        .maybeSingle()
      return c?.id ?? null
    },
    enabled: !!user && !!profile?.org_id,
    staleTime: 300_000,
  })

  // Recipient profile (for direct threads)
  const { data: recipient } = useQuery({
    queryKey: ['msg-recipient', userId],
    queryFn: async () => {
      if (isGroup) return null
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', userId!)
        .maybeSingle()
      return data
    },
    enabled: !isGroup && !!userId,
  })

  // Messages
  const { data: messages = [] } = useQuery({
    queryKey: ['thread-msgs', userId, user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const q = (supabase as any)
        .from('messages')
        .select('id, body, created_at, sender_id, sender:profiles!sender_id(full_name, role)')
        .eq('org_id', profile!.org_id!)
        .order('created_at', { ascending: true })
        .limit(200)

      if (isGroup) {
        q.is('recipient_id', null)
      } else {
        q.or(
          `and(sender_id.eq.${user!.id},recipient_id.eq.${userId}),and(sender_id.eq.${userId},recipient_id.eq.${user!.id})`
        )
      }

      const { data } = await q
      return data ?? []
    },
    enabled: !!profile?.org_id && !!user,
    refetchInterval: 15000,
  })

  // Mark as seen when viewing thread
  useEffect(() => {
    localStorage.setItem(`msg_last_seen_${user!.id}`, new Date().toISOString())
    qc.invalidateQueries({ queryKey: ['unread-count'] })
    qc.invalidateQueries({ queryKey: ['family-unread'] })
    qc.invalidateQueries({ queryKey: ['msg-unread-map'] })
  }, [user, qc])

  // Scroll to bottom — set scrollTop directly for reliable iOS Safari behaviour
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  // Realtime
  useEffect(() => {
    if (!profile?.org_id) return
    const ch = supabase.channel(`thread-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `org_id=eq.${profile.org_id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['thread-msgs'] })
        localStorage.setItem(`msg_last_seen_${user!.id}`, new Date().toISOString())
        qc.invalidateQueries({ queryKey: ['unread-count'] })
        qc.invalidateQueries({ queryKey: ['msg-unread-map'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [profile?.org_id, userId, user, qc])

  async function send() {
    if (!body.trim() || !profile?.org_id || sending) return
    const text = body.trim()
    setSending(true)
    setBody('')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('messages').insert({
      org_id: profile.org_id,
      sender_id: user!.id,
      recipient_id: isGroup ? null : userId,
      body: text,
      ...(clientId ? { client_id: clientId } : {}),
    })

    setSending(false)
    if (!error) {
      qc.invalidateQueries({ queryKey: ['thread-msgs'] })
      qc.invalidateQueries({ queryKey: ['msg-last'] })
    } else {
      setBody(text)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  const title = isGroup
    ? 'Family group'
    : recipient
    ? `${recipient.full_name} · ${ROLE_LABEL[recipient.role] ?? recipient.role}`
    : 'Loading…'

  const isWorker = profile?.role === 'support_worker' || profile?.role === 'trusted_support_worker'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: 'var(--color-bg)' }}>
      {!isWorker && <FamilyStickyHeader />}
      {/* Header */}
      <div style={{
        padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)', flexShrink: 0,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate('/messages')}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9375rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isGroup ? '👨‍👩‍👧 ' : ''}{title}
          </p>
          {isGroup && (
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-muted)' }}>
              Shared thread — all family & coordinator
            </p>
          )}
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: 'auto', padding: '1rem',
          display: 'flex', flexDirection: 'column', gap: '0.5rem',
          overscrollBehavior: 'contain',
        }}
      >
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--color-muted)', paddingTop: '3rem', fontSize: '0.875rem' }}>
            No messages yet. Say hello!
          </div>
        )}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        {messages.map((msg: any) => {
          const isMine = msg.sender_id === user!.id
          return (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column',
              alignItems: isMine ? 'flex-end' : 'flex-start' }}>
              {!isMine && (
                <p style={{ margin: '0 0.5rem 0.2rem', fontSize: '0.7rem', color: 'var(--color-muted)' }}>
                  {msg.sender?.full_name ?? 'Unknown'}
                </p>
              )}
              <div style={{
                maxWidth: '75%', padding: '0.5rem 0.75rem',
                borderRadius: isMine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                background: isMine ? 'var(--color-primary)' : 'var(--color-surface)',
                color: isMine ? '#fff' : 'var(--color-text)',
                fontSize: '0.9rem', lineHeight: 1.5,
                boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                wordBreak: 'break-word',
              }}>
                {msg.body}
              </div>
              <p style={{ margin: '0.2rem 0.5rem 0', fontSize: '0.65rem', color: 'var(--color-muted)' }}>
                {formatTime(msg.created_at)}
              </p>
            </div>
          )
        })}
      </div>

      {/* Input bar */}
      <div style={{
        padding: `0.75rem 1rem max(0.75rem, env(safe-area-inset-bottom))`,
        borderTop: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        display: 'flex', gap: '0.5rem', alignItems: 'flex-end',
        flexShrink: 0,
      }}>
        <textarea
          className="input"
          value={body}
          onChange={e => setBody(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={1}
          style={{
            flex: 1, resize: 'none', minHeight: 44,
            maxHeight: 120, overflow: 'auto', lineHeight: 1.5,
            fontSize: '1rem', padding: '0.625rem 0.875rem',
          }}
        />
        <button
          className="btn btn-primary"
          onClick={send}
          disabled={sending || !body.trim()}
          style={{ flexShrink: 0, height: 44, padding: '0 1rem' }}
        >
          {sending ? <span className="spinner" /> : 'Send'}
        </button>
      </div>
    </div>
  )
}
