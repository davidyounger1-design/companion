import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { signOut } from '../../lib/auth'
import { useAuth } from '../../context/AuthContext'
import { useFeatures } from '../../hooks/useFeatures'
import { FEATURES } from '../../lib/features'
import { useUnreadMessagesMap } from '../../hooks/useUnreadMessagesMap'
import { SettingsIcon } from '../../components/icons'
import ColorModePill from '../../components/ColorModePill'

export default function WorkerLayout() {
  const { profile, user } = useAuth()
  const navigate = useNavigate()
  // Same shared per-thread map MessagesHub renders, summed — keeps this
  // badge consistent with the list the same way FamilyBottomNav's is.
  const { data: unreadMap = {} } = useUnreadMessagesMap()
  const unread = Object.values(unreadMap).reduce((sum, n) => sum + n, 0)
  const { has } = useFeatures()
  const showMessages = has(FEATURES.messaging)

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flex: '1 1 auto', justifyContent: 'flex-end' }}>
          <ColorModePill />
          <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => navigate('/settings/display')} style={{ flexShrink: 0 }}>
            <SettingsIcon size={18} />
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 0, overflow: 'hidden' }}>
            <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', flexShrink: 0, whiteSpace: 'nowrap' }}>
              Sign out
            </button>
            {(profile?.full_name || user?.email) && (
              <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', paddingRight: '0.5rem', textAlign: 'right', lineHeight: 1.4, maxWidth: '100%', overflow: 'hidden' }}>
                {profile?.full_name && (
                  <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.full_name}</span>
                )}
                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</span>
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
        {showMessages && (
          <NavLink to="/messages" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
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
        )}
        <NavLink to="/feedback" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <span style={{ fontSize: '1.25rem' }}>📝</span>
          Feedback
        </NavLink>
        <NavLink to="/help" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <span style={{ fontSize: '1.25rem' }}>❓</span>
          Help
        </NavLink>
      </nav>
    </div>
  )
}
