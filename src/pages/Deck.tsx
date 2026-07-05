import { Link } from 'react-router-dom'

export default function Deck() {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: '#0b1a12' }}>
      <nav style={{
        padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(11,26,18,0.92)', borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <Link to="/" style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 600, color: '#fff', textDecoration: 'none' }}>
          ← Companion
        </Link>
        <a
          href="/investor-deck.html"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.75)', textDecoration: 'none' }}
        >
          Open in new tab ↗
        </a>
      </nav>
      <iframe
        src="/investor-deck.html"
        title="Companion investor deck"
        style={{ flex: 1, border: 'none', width: '100%' }}
      />
    </div>
  )
}
