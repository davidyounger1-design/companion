import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useFeatures } from '../hooks/useFeatures'
import { FEATURES } from '../lib/features'
import { usePendingTickets } from '../hooks/usePendingTickets'
import { useUnreadMessagesMap } from '../hooks/useUnreadMessagesMap'
import { JournalIcon, TimerIcon, ScheduleIcon, NoticesIcon, MessagesIcon, HelpIcon, PlanIcon } from './icons'

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
  const isRecipient = profile?.role === 'recipient'
  const { has } = useFeatures()
  const showMessages = !isRecipient && has(FEATURES.messaging)

  // Same shared map MessagesHub renders per-contact, summed for a single
  // badge — so the two can never disagree the way two independently
  // polled, separately-implemented counts could.
  const { data: unreadMap = {} } = useUnreadMessagesMap()
  const unread = Object.values(unreadMap).reduce((sum, n) => sum + n, 0)

  const pendingTickets = usePendingTickets()

  const items: NavEntry[] = [
    { label: 'Journal',  icon: <JournalIcon />,  path: '/family' },
    { label: 'Schedule', icon: <ScheduleIcon />, path: '/family/schedule' },
    { label: 'Notices',  icon: <NoticesIcon />,  path: '/family/notices' },
    // The visual timer is a recipient-only tool.
    ...(isRecipient ? [{ label: 'Timer', icon: <TimerIcon />, path: '/family/timer' }] : []),
    // Recipients don't have a messaging inbox; and messaging is a plan feature.
    ...(showMessages ? [{ label: 'Messages', icon: <MessagesIcon />, path: '/messages', badge: unread, badgeLabel: 'unread messages' }] : []),
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
