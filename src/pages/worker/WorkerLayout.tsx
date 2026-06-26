import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { signOut } from '../../lib/auth'
import { useAuth } from '../../context/AuthContext'

export default function WorkerLayout() {
  const { profile, user } = useAuth()
  const navigate = useNavigate()

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
        <NavLink to="/worker/notes" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <span style={{ fontSize: '1.25rem' }}>📋</span>
          Notes
        </NavLink>
        <NavLink to="/worker/messages" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
          <span style={{ fontSize: '1.25rem' }}>💬</span>
          Messages
        </NavLink>
        {profile?.role === 'trusted_support_worker' && (
          <NavLink to="/members" className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
            <span style={{ fontSize: '1.25rem' }}>➕</span>
            Invite
          </NavLink>
        )}
      </nav>
    </div>
  )
}

