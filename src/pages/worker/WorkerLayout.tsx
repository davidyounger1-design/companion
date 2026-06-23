import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { signOut } from '../../lib/auth'
import { useAuth } from '../../context/AuthContext'

export default function WorkerLayout() {
  const { profile } = useAuth()
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
          <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{firstName(profile?.full_name)}</span>
          <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem' }}>
            Out
          </button>
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
      </nav>
    </div>
  )
}

function firstName(name?: string | null) {
  return name?.split(' ')[0] ?? 'there'
}
