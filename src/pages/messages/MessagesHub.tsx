import { useEffect } from 'react'
import { MobileFooter } from '../../components/SiteFooter'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import FamilyStickyHeader from '../../components/FamilyStickyHeader'

function formatTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

const ROLE_LABEL: Record<string, string> = {
  coordinator: 'Coordinator',
  family: 'Family',
  trusted_support_worker: 'Trusted worker',
  support_worker: 'Support worker',
  therapist: 'Therapist',
}

export default function MessagesHub() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const isFamily = profile?.role === 'family' || profile?.role === 'coordinator'

  // All org members except self
  const { data: members = [] } = useQuery({
    queryKey: ['msg-contacts', profile?.org_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('org_id', profile!.org_id!)
        .neq('id', user!.id)
        .order('role')
        .order('full_name')
      return data ?? []
    },
    enabled: !!profile?.org_id && !!user,
  })

  // Last message per contact (for preview)
  const { data: lastMessages = {} } = useQuery({
    queryKey: ['msg-last', profile?.org_id, user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('messages')
        .select('id, body, created_at, sender_id, recipient_id')
        .eq('org_id', profile!.org_id!)
        // Only threads I'm actually part of — a coordinator/family member with
        // broader read access to other people's threads (for oversight) shouldn't
        // have those previews misattributed to their own contact rows.
        .or(`sender_id.eq.${user!.id},recipient_id.eq.${user!.id},recipient_id.is.null`)
        .order('created_at', { ascending: false })
        .limit(200)
      const map: Record<string, { body: string; created_at: string }> = {}
      for (const msg of data ?? []) {
        const key =
          msg.recipient_id === null
            ? 'group'
            : msg.sender_id === user!.id
            ? msg.recipient_id
            : msg.sender_id
        if (!map[key]) map[key] = { body: msg.body, created_at: msg.created_at }
      }
      return map
    },
    enabled: !!profile?.org_id && !!user,
    refetchInterval: 15000,
  })

  // Unread count per contact
  const { data: unreadMap = {} } = useQuery({
    queryKey: ['msg-unread-map', user?.id],
    queryFn: async () => {
      const lastSeen = localStorage.getItem(`msg_last_seen_${user!.id}`) ?? new Date(0).toISOString()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('messages')
        .select('sender_id, recipient_id')
        .eq('org_id', profile!.org_id!)
        .gt('created_at', lastSeen)
        .neq('sender_id', user!.id)
        .or(`recipient_id.eq.${user!.id},recipient_id.is.null`)
      const map: Record<string, number> = {}
      for (const msg of data ?? []) {
        const key = msg.recipient_id === null ? 'group' : msg.sender_id
        map[key] = (map[key] ?? 0) + 1
      }
      return map
    },
    enabled: !!user && !!profile?.org_id,
    refetchInterval: 15000,
  })

  // Realtime refresh
  useEffect(() => {
    if (!profile?.org_id) return
    const ch = supabase.channel('hub-msgs')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `org_id=eq.${profile.org_id}` }, () => {
        qc.invalidateQueries({ queryKey: ['msg-last'] })
        qc.invalidateQueries({ queryKey: ['msg-unread-map'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [profile?.org_id, qc])

  // Workers go back to their portal; everyone else (family, coordinator,
  // recipient) belongs in the family journal — never send a recipient to /worker.
  const isWorker = profile?.role === 'support_worker' || profile?.role === 'trusted_support_worker'
  const backPath = isWorker ? '/worker' : '/family'

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      {!isWorker && <FamilyStickyHeader />}
      <div style={{
        padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-bg)', position: 'sticky', top: 'var(--family-header-h, 0px)', zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate(backPath)}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Messages</h1>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Family group thread (visible to family + coordinator) */}
        {isFamily && (
          <ContactRow
            icon="👨‍👩‍👧"
            name="Family group"
            subtitle="Shared thread — all family & coordinator"
            lastMsg={lastMessages['group']}
            unread={unreadMap['group'] ?? 0}
            onClick={() => navigate('/messages/group')}
          />
        )}

        {members.length === 0 && !isFamily && (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--color-muted)' }}>
            <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>💬</p>
            <p>No other members in this organisation yet.</p>
          </div>
        )}

        {members.map((m: any) => (
          <ContactRow
            key={m.id}
            icon={roleIcon(m.role)}
            name={m.full_name}
            subtitle={ROLE_LABEL[m.role] ?? m.role}
            lastMsg={lastMessages[m.id]}
            unread={unreadMap[m.id] ?? 0}
            onClick={() => navigate(`/messages/${m.id}`)}
          />
        ))}
        <MobileFooter />
      </div>
    </div>
  )
}

function roleIcon(role: string) {
  const map: Record<string, string> = {
    coordinator: '⭐',
    family: '👤',
    trusted_support_worker: '🤝',
    support_worker: '👤',
    therapist: '🩺',
  }
  return map[role] ?? '👤'
}

function ContactRow({ icon, name, subtitle, lastMsg, unread, onClick }: {
  icon: string
  name: string
  subtitle: string
  lastMsg?: { body: string; created_at: string }
  unread: number
  onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      width: '100%', background: 'none', border: 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: '0.875rem',
      padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
      textAlign: 'left',
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
        background: 'color-mix(in srgb, var(--color-primary) 15%, transparent)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.2rem',
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
          <p style={{ margin: 0, fontWeight: unread > 0 ? 700 : 500, fontSize: '0.9375rem',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
          {lastMsg && (
            <span style={{ fontSize: '0.72rem', color: 'var(--color-muted)', flexShrink: 0 }}>
              {formatTime(lastMsg.created_at)}
            </span>
          )}
        </div>
        <p style={{ margin: '0.1rem 0 0', fontSize: '0.8125rem', color: 'var(--color-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lastMsg ? lastMsg.body : subtitle}
        </p>
      </div>
      {unread > 0 && (
        <div style={{
          width: 20, height: 20, borderRadius: '50%', background: 'var(--color-primary)',
          color: '#fff', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>{unread > 9 ? '9+' : unread}</div>
      )}
    </button>
  )
}
