import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { SettingsIcon } from './icons'
import ColorModePill from './ColorModePill'

/** The branded top bar for the whole family/recipient portal — logo, role
 * badge, name/email, appearance pill, and settings/sign-out. Shared by every
 * page under FamilyLayout (and by Messages, which family/coordinator and
 * workers both reach) so it's consistent no matter where you navigate. */
export default function FamilyHeader() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [showMenu, setShowMenu] = useState(false)

  const isCoordinator = profile?.role === 'coordinator'
  const isRecipient = profile?.role === 'recipient'
  const currentUserName = profile?.full_name ?? ''

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <header style={{
      background: 'var(--color-surface)',
      borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
      padding: '0.875rem 1.25rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600 }}>Companion</span>
        <span className="badge badge-sage" style={{ marginLeft: '0.5rem', fontSize: '0.65rem' }}>
          {isCoordinator ? 'Coordinator' : isRecipient ? 'Recipient' : 'Family'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', position: 'relative', minWidth: 0, flex: '1 1 auto', justifyContent: 'flex-end' }}>
        {(currentUserName || user?.email) && (
          <span style={{ fontSize: '0.68rem', color: 'var(--color-muted)', textAlign: 'right', lineHeight: 1.35, minWidth: 0, overflow: 'hidden' }}>
            {currentUserName && (
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{currentUserName}</span>
            )}
            <span style={{ display: 'block', opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</span>
          </span>
        )}
        {isCoordinator && (
          <>
            <ColorModePill />
            <button
              onClick={() => setShowMenu(m => !m)}
              style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 8, padding: '0.4rem 0.6rem', cursor: 'pointer', lineHeight: 1, color: 'var(--color-text)', display: 'flex', alignItems: 'center', flexShrink: 0 }}
              title="Menu"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
              </svg>
            </button>
            {showMenu && (
              <>
                <div onClick={() => setShowMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 20,
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                  minWidth: 180, overflow: 'hidden',
                }}>
                  {[
                    { label: '👥 Members', path: '/members' },
                    { label: '⚙️ Settings', path: '/settings/display' },
                  ].map(({ label, path }) => (
                    <button key={path} onClick={() => { navigate(path); setShowMenu(false) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--color-border)', padding: '0.7rem 1rem', cursor: 'pointer', fontSize: '0.875rem', color: 'var(--color-text)' }}>
                      {label}
                    </button>
                  ))}
                  <button onClick={() => { handleSignOut(); setShowMenu(false) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderBottom: '1px solid var(--color-border)', padding: '0.7rem 1rem', cursor: 'pointer', fontSize: '0.875rem', color: '#ef4444' }}>
                    Sign out
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {!isCoordinator && (
          <>
            <ColorModePill />
            <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => navigate('/settings/display')} style={{ flexShrink: 0 }}>
              <SettingsIcon size={18} />
            </button>
            <button className="btn btn-ghost" onClick={handleSignOut}
              style={{ fontSize: '0.8rem', padding: '0.4rem 0.75rem', flexShrink: 0, whiteSpace: 'nowrap' }}>Sign out</button>
          </>
        )}
      </div>
    </header>
  )
}
