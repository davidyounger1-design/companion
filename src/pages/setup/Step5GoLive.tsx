import { useNavigate } from 'react-router-dom'

export default function Step5GoLive() {
  const navigate = useNavigate()


  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🌿</div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.75rem' }}>You're all set</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '2rem', lineHeight: 1.7, maxWidth: 380, margin: '0 auto 2rem' }}>
        Your organisation is live. Head to your dashboard to manage participants,
        review daily logs, and keep your team connected.
      </p>

      <div className="card" style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <p className="eyebrow" style={{ marginBottom: '0.75rem' }}>What's next</p>
        {[
          'Assign support workers to participants',
          'Invite family members to the care circle',
          'Workers can log from their phone via /worker',
          'Families receive a daily digest automatically',
        ].map((item) => (
          <p key={item} style={{ fontSize: '0.875rem', margin: '0.4rem 0' }}>→ {item}</p>
        ))}
      </div>

      <button
        className="btn btn-primary btn-full"
        onClick={() => navigate('/dashboard')}
        style={{ fontSize: '1rem' }}
      >
        Go to dashboard →
      </button>
    </div>
  )
}
