import { APP_VERSION } from '../pages/ReleaseNotes'

export default function AppFooter({ inline = false }: { inline?: boolean }) {
  const year = new Date().getFullYear()
  const style = inline ? {
    borderTop: '1px solid var(--color-border)',
    paddingTop: '1rem',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.35rem',
    alignItems: 'center',
    textAlign: 'center' as const,
  } : {}

  return (
    <div className={inline ? undefined : 'app-footer-nav'} style={style}>
      <a href="https://myappbuddy.com.au" target="_blank" rel="noopener noreferrer"
        style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--color-primary)', textDecoration: 'none' }}>
        MyAppBuddy
      </a>
      <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>Companion v{APP_VERSION}</span>
      <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)' }}>© {year} MyAppBuddy</span>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.15rem' }}>
        <a href="https://myappbuddy.com.au/privacy" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textDecoration: 'underline' }}>Privacy</a>
        <a href="https://myappbuddy.com.au/terms" target="_blank" rel="noopener noreferrer"
          style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textDecoration: 'underline' }}>Terms</a>
      </div>
    </div>
  )
}
