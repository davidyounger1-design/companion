import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export default function Step0Account() {
  const navigate = useNavigate()
  const { profile } = useAuth()

  // If the coordinator already has an org, skip to service step
  if (profile?.org_id) {
    navigate('/setup/service')
    return null
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        Your account is ready
      </h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '2rem' }}>
        Now let's set up your organisation. This takes about 5 minutes.
      </p>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Signed in as</p>
        <p style={{ fontWeight: 600, fontSize: '1rem', margin: 0 }}>{profile?.full_name}</p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.25rem' }}>
          Role: Coordinator
        </p>
      </div>

      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
        You'll set up your organisation details, choose a plan, invite your team, and add your first participants.
        Your 14-day free trial starts when you choose a plan.
      </p>

      <button
        className="btn btn-primary btn-full"
        onClick={() => navigate('/setup/service')}
        style={{ fontSize: '1rem' }}
      >
        Continue to service details →
      </button>
    </div>
  )
}
