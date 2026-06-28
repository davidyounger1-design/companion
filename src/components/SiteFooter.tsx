import { APP_VERSION } from '../pages/ReleaseNotes'

export default function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="site-footer">
      <span>© {year} MyAppBuddy · Companion v{APP_VERSION}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <a href="https://myappbuddy.com.au" target="_blank" rel="noopener noreferrer">
          Powered by <strong>MyAppBuddy</strong>
        </a>
        <a href="https://myappbuddy.com.au/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
        <a href="https://myappbuddy.com.au/terms" target="_blank" rel="noopener noreferrer">Terms</a>
      </span>
    </footer>
  )
}

export function MobileFooter() {
  const year = new Date().getFullYear()
  return (
    <div className="mobile-footer">
      <a href="https://myappbuddy.com.au" target="_blank" rel="noopener noreferrer">MyAppBuddy</a>
      {` · Companion v${APP_VERSION} · © `}{year}
      {' · '}
      <a href="https://myappbuddy.com.au/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
      {' · '}
      <a href="https://myappbuddy.com.au/terms" target="_blank" rel="noopener noreferrer">Terms</a>
    </div>
  )
}
