import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Landing() {
  const { user, profile, loading } = useAuth()

  if (!loading && user) {
    if (profile?.role === 'support_worker') return <Navigate to="/worker" replace />
    if (profile?.org_id) return <Navigate to="/dashboard" replace />
    return <Navigate to="/setup/account" replace />
  }
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)' }}>
      {/* Nav */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1.25rem 1.5rem',
        maxWidth: 960,
        margin: '0 auto',
      }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', fontWeight: 600, color: 'var(--color-ink)' }}>
          Companion
        </span>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Link to="/sign-in" className="btn btn-ghost" style={{ fontSize: '0.9rem' }}>Sign in</Link>
          <Link to="/sign-up" className="btn btn-primary">Get started</Link>
        </div>
      </nav>

      {/* Hero */}
      <section style={{ textAlign: 'center', padding: '4rem 1.5rem 3rem', maxWidth: 640, margin: '0 auto' }}>
        <p className="eyebrow" style={{ marginBottom: '1rem' }}>NDIS care coordination</p>
        <h1 style={{ fontSize: 'clamp(2rem, 6vw, 3.2rem)', marginBottom: '1.25rem', fontWeight: 400 }}>
          To be informed<br />
          <em>is to care.</em>
        </h1>
        <p style={{ fontSize: '1.1rem', color: 'var(--color-muted)', marginBottom: '2.5rem', lineHeight: 1.7 }}>
          Companion connects support workers, families, and therapists around each participant —
          with privacy by consent at every step.
        </p>
        <Link to="/sign-up" className="btn btn-primary" style={{ fontSize: '1rem', padding: '0.875rem 2rem' }}>
          Start free trial
        </Link>
      </section>

      {/* Feature grid */}
      <section style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          {FEATURES.map((f) => (
            <div key={f.title} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{f.icon}</div>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.4rem', fontFamily: 'var(--font-ui)', fontWeight: 700 }}>{f.title}</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: 0 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ background: 'var(--color-surface)', padding: '3rem 1.5rem' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <p className="eyebrow" style={{ textAlign: 'center', marginBottom: '0.75rem' }}>Pricing</p>
          <h2 style={{ textAlign: 'center', marginBottom: '2rem', fontWeight: 400 }}>Simple, per-client pricing</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {PLANS.map((p) => (
              <div key={p.name} className="card" style={{ border: p.highlight ? '2px solid var(--color-primary)' : undefined }}>
                {p.highlight && <p className="badge badge-sage" style={{ marginBottom: '0.75rem' }}>Popular</p>}
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem', fontFamily: 'var(--font-ui)', fontWeight: 700 }}>{p.name}</h3>
                <p style={{ fontSize: '1.6rem', fontFamily: 'var(--font-display)', fontWeight: 600, margin: '0.5rem 0' }}>{p.price}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>{p.sub}</p>
                {p.features.map((f) => (
                  <p key={f} style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>✓ {f}</p>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

const FEATURES = [
  { icon: '📋', title: 'Daily logs', desc: 'Workers log meals, activities, and mood from their phone in seconds.' },
  { icon: '❤️', title: 'Family digest', desc: 'Families get a calm daily summary — no logins needed to stay informed.' },
  { icon: '🔒', title: 'Consent-first notes', desc: 'Behaviour notes stay private until the participant explicitly shares them.' },
  { icon: '🌿', title: 'Care circles', desc: 'Therapists see only what the decision-maker chooses to share, nothing more.' },
]

const PLANS = [
  {
    name: 'Solo',
    price: 'A$29/mo',
    sub: 'Up to 3 participants',
    highlight: false,
    features: ['3 active participants', 'Unlimited workers & family', 'Daily digest', 'Behaviour notes'],
  },
  {
    name: 'Starter',
    price: 'A$49/mo',
    sub: 'Up to 10 participants',
    highlight: true,
    features: ['10 active participants', 'Unlimited workers & family', 'Daily digest', 'Behaviour notes', 'Provider dashboard'],
  },
  {
    name: 'Team',
    price: 'A$7/participant',
    sub: 'per month, no cap',
    highlight: false,
    features: ['Unlimited participants', 'NDIS exports', 'Incident workflows', 'Priority support', 'White-label theming'],
  },
]
