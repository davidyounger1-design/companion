import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

export default function FamilyBottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user, profile, org } = useAuth()
  const isOrgOwner = !!user && !!org?.owner_id && org.owner_id === user.id

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
    refetchInterval: 30000,
  })

  function item(label: string, icon: string, path: string, badge = 0) {
    const active = path === '/family'
      ? pathname === '/family'
      : pathname.startsWith(path)
    return (
      <button
        key={path}
        onClick={() => navigate(path)}
        className={`bottom-nav-item${active ? ' active' : ''}`}
        style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <span style={{ fontSize: '1.25rem', position: 'relative', display: 'inline-flex' }}>
          {icon}
          {badge > 0 && (
            <span style={{
              position: 'absolute', top: -4, right: -6,
              background: '#ef4444', color: '#fff',
              borderRadius: '50%', width: 16, height: 16,
              fontSize: '0.6rem', fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
            }}>{badge > 9 ? '9+' : badge}</span>
          )}
        </span>
        {label}
      </button>
    )
  }

  return (
    <nav className="bottom-nav">
      {item('Journal', '📔', '/family')}
      {item('Notices', '📌', '/family/notices')}
      {item('Messages', '💬', '/messages', unread)}
      {item('Help', '❓', '/feedback')}
      {isOrgOwner && item('Plan', '💳', '/account')}
    </nav>
  )
}
