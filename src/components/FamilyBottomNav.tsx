import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { usePendingTickets } from '../hooks/usePendingTickets'

// ── SVG icons — consistent stroke-based rendering on all platforms ─────────

function JournalIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      <line x1="12" y1="7" x2="17" y2="7" />
      <line x1="12" y1="11" x2="17" y2="11" />
    </svg>
  )
}

function NoticesIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function MessagesIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <circle cx="12" cy="17" r=".5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function PlanIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

type NavEntry = {
  label: string
  icon: React.ReactNode
  path: string
  badge?: number
  badgeLabel?: string
}

export default function FamilyBottomNav() {
  const navigate   = useNavigate()
  const { pathname } = useLocation()
  const { user, profile, org } = useAuth()
  const isOrgOwner = !!user && !!org?.owner_id && org.owner_id === user.id
  const isCoordinator = profile?.role === 'coordinator'

  const { data: unread = 0 } = useQuery({
    queryKey: ['family-unread', user?.id],
    queryFn: async () => {
      if (!user || !profile?.org_id) return 0
      const lastSeen = localStorage.getItem(`msg_last_seen_${user.id}`) ?? new Date(0).toISOString()
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', profile.org_id)
        .gt('created_at', lastSeen)
        .neq('sender_id', user.id)
      return count ?? 0
    },
    enabled: !!user && !!profile?.org_id,
    refetchInterval: 30_000,
  })

  const pendingTickets = usePendingTickets()

  const items: NavEntry[] = [
    { label: 'Journal',  icon: <JournalIcon />,  path: '/family' },
    { label: 'Notices',  icon: <NoticesIcon />,  path: '/family/notices' },
    { label: 'Messages', icon: <MessagesIcon />, path: '/messages', badge: unread, badgeLabel: 'unread messages' },
    // When a ticket is awaiting the user's reply, send Help straight to the
    // Support tab so the badge points at what needs attention.
    { label: 'Help',     icon: <HelpIcon />,     path: pendingTickets > 0 ? '/help?tab=support' : '/help', badge: pendingTickets, badgeLabel: 'support tickets awaiting your reply' },
    ...(isOrgOwner && !isCoordinator ? [{ label: 'Plan', icon: <PlanIcon />, path: '/account' }] : []),
  ]

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {items.map(({ label, icon, path, badge, badgeLabel }) => {
        // Compare against the path without any query string (pathname has none).
        const base = path.split('?')[0]
        const active = base === '/family'
          ? pathname === '/family'
          : pathname.startsWith(base)
        return (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`bottom-nav-item${active ? ' active' : ''}`}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
          >
            <span className="nav-icon-wrap">
              {icon}
              {(badge ?? 0) > 0 && (
                <span className="nav-badge" aria-label={`${badge} ${badgeLabel ?? 'unread'}`}>
                  {(badge ?? 0) > 9 ? '9+' : badge}
                </span>
              )}
            </span>
            <span className="nav-label">{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
