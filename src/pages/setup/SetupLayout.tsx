import { Outlet, useLocation, Link } from 'react-router-dom'
import { signOut } from '../../lib/auth'
import { useNavigate } from 'react-router-dom'

const STEPS = [
  { path: 'account', label: 'Account' },
  { path: 'service',  label: 'Service details' },
  { path: 'plan',    label: 'Choose plan' },
  { path: 'team',    label: 'Invite team' },
  { path: 'clients', label: 'Add participants' },
  { path: 'circles', label: 'Families & therapists' },
  { path: 'go-live', label: 'Go live' },
]

export default function SetupLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const currentStep = STEPS.findIndex((s) => location.pathname.endsWith(s.path))

  async function handleSignOut() {
    await signOut()
    navigate('/')
  }

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.5rem',
        background: 'var(--color-surface)',
        borderBottom: '1px solid color-mix(in srgb, var(--color-muted) 20%, transparent)',
      }}>
        <Link
          to="/"
          style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 600, color: 'var(--color-ink)', textDecoration: 'none' }}
        >
          Companion
        </Link>
        <button className="btn btn-ghost" onClick={handleSignOut} style={{ fontSize: '0.85rem' }}>
          Sign out
        </button>
      </header>

      {/* Step progress */}
      <div style={{ padding: '1.25rem 1.5rem 0', maxWidth: 520, margin: '0 auto', width: '100%' }}>
        <p className="eyebrow" style={{ marginBottom: '0.6rem' }}>
          Step {currentStep + 1} of {STEPS.length} — {STEPS[currentStep]?.label}
        </p>
        <div className="step-progress">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`step-dot${i === currentStep ? ' active' : i < currentStep ? ' done' : ''}`}
            />
          ))}
        </div>
      </div>

      {/* Page content */}
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: 520, margin: '0 auto', width: '100%' }}>
        <Outlet />
      </main>
    </div>
  )
}
