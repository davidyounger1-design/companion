import { Outlet, useLocation } from 'react-router-dom'

const STEPS = [
  { path: 'participant', label: 'Who are you caring for?' },
  { path: 'invite',      label: 'Invite family members' },
  { path: 'done',        label: 'All set' },
]

export default function FamilySetupLayout() {
  const { pathname } = useLocation()
  const current = STEPS.findIndex(s => pathname.includes(s.path))

  return (
    <div style={{
      minHeight: '100dvh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '2rem 1rem', background: 'var(--color-bg)',
    }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Step dots */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: '2.5rem' }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: i <= current ? 'var(--color-primary)' : 'var(--color-border)',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>

        <Outlet />
      </div>
    </div>
  )
}
