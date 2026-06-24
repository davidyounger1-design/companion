import { useNavigate } from 'react-router-dom'

export default function Step5Circles() {
  const navigate = useNavigate()

  return (
    <div>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>Families &amp; therapists</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: '2rem', lineHeight: 1.7 }}>
        Once participants are created, you can invite family members and link therapists to each person's care circle.
        You control exactly what each person can see.
      </p>

      <div className="card" style={{ marginBottom: '2rem' }}>
        {[
          { icon: '❤️', title: 'Family members', desc: 'Receive a calm daily digest. No logins required — opt-in email summaries.' },
          { icon: '🩺', title: 'Therapists & allied health', desc: 'See only the logs and notes the decision-maker has explicitly shared.' },
        ].map((item) => (
          <div key={item.title} style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.4rem' }}>{item.icon}</span>
            <div>
              <p style={{ fontWeight: 700, fontFamily: 'var(--font-ui)', margin: '0 0 0.2rem' }}>{item.title}</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: 0 }}>{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
        You can set this up from each participant's profile in the dashboard.
      </p>

      <button className="btn btn-primary btn-full" onClick={() => navigate('/setup/go-live')} style={{ fontSize: '1rem' }}>
        Continue →
      </button>
    </div>
  )
}
