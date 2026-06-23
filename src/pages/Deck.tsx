import { Link } from 'react-router-dom'

export default function Deck() {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', display: 'flex', flexDirection: 'column' }}>
      <nav style={{ padding: '1.25rem 1.5rem', maxWidth: 960, margin: '0 auto', width: '100%' }}>
        <Link to="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 600, color: 'var(--color-ink)', textDecoration: 'none' }}>
          Companion
        </Link>
      </nav>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem 1.5rem' }}>
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>🌿</div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.75rem' }}>Investor information</h1>
          <p style={{ color: 'var(--color-muted)', lineHeight: 1.7, marginBottom: '2rem' }}>
            We're sharing our deck on request. Send us a note and we'll be in touch within one business day.
          </p>
          <a
            href="mailto:david@theservicemanager.com?subject=Companion investor deck request"
            className="btn btn-primary"
            style={{ fontSize: '1rem', padding: '0.875rem 2rem' }}
          >
            Request the deck →
          </a>
          <p style={{ marginTop: '1.25rem' }}>
            <Link to="/" style={{ fontSize: '0.875rem', color: 'var(--color-muted)', textDecoration: 'none' }}>
              ← Back to Companion
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
