import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { signOut } from '../../lib/auth'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const APP_VERSION = '0.2.0'

function useUnreadCount() {
  const { user, profile } = useAuth()
  return useQuery({
    queryKey: ['unread-count', user?.id],
    queryFn: async () => {
      if (!user || !profile?.org_id) return 0
      const lastSeen = localStorage.getItem(`msg_last_seen_${user.id}`) ?? new Date(0).toISOString()
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', profile.org_id)
        .gt('created_at', lastSeen)
        .neq('sender_id', user.id)
        .or(`recipient_id.eq.${user.id},recipient_id.is.null`)
      return count ?? 0
    },
    enabled: !!user && !!profile?.org_id,
    refetchInterval: 30000,
  })
}

export default function WorkerLayout() {
  const { profile, user } = useAuth()
  const navigate = useNavigate()
  const { data: unread = 0 } = useUnreadCount()

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: 'calc(56px + var(--safe-bottom))' }}>
      {/* Header */}
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
        padding: '0.875rem 1.25rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600 }}>Companion</span>
          <span className="badge badge-sage" style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>Worker</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
            <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}>
              Sign out
            </button>
            {(profile?.full_name || user?.email) && (
              <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', paddingRight: '0.5rem', textAlign: 'right', lineHeight: 1.4 }}>
                {profile?.full_name && <>{profile.full_name}<br /></>}
                {user?.email}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Page */}
      <Outlet />

      {/* Bottom nav */}
      <nav className="bottom-nav">
        <NavLink to="/worker" end className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <span style={{ fontSize: '1.25rem' }}>👥</span>
          Clients
        </NavLink>
        <NavLink to="/worker/notices" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <span style={{ fontSize: '1.25rem' }}>📌</span>
          Notices
        </NavLink>
        <NavLink to="/worker/messages" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <span style={{ fontSize: '1.25rem', position: 'relative', display: 'inline-flex' }}>
            💬
            {unread > 0 && (
              <span style={{
                position: 'absolute', top: -4, right: -6,
                background: '#ef4444', color: '#fff',
                borderRadius: '50%', width: 16, height: 16,
                fontSize: '0.6rem', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1,
              }}>{unread > 9 ? '9+' : unread}</span>
            )}
          </span>
          Messages
        </NavLink>
        <NavLink to="/release-notes" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <span style={{ fontSize: '1.25rem' }}>ℹ️</span>
          v{APP_VERSION}
        </NavLink>
      </nav>
    </div>
  )
}
