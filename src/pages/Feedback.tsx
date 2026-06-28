import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import React from 'react'
import { MobileFooter } from '../components/SiteFooter'

const MAB_BASE = 'https://myappbuddy.com.au'

function loadScript(id: string, src: string): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById(id)) { resolve(); return }
    const s = document.createElement('script')
    s.id = id
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => resolve() // resolve anyway so we don't hang
    document.head.appendChild(s)
  })
}

export default function Feedback() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [scriptsReady, setScriptsReady] = useState(
    () => !!customElements.get('myappbuddy-support') && !!customElements.get('myappbuddy-ideas')
  )

  const userEmail = user?.email ?? ''
  const userName = profile?.full_name ?? ''

  useEffect(() => {
    if (scriptsReady) return
    const timeout = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
    const whenDefinedOrTimeout = (name: string) =>
      Promise.race([customElements.whenDefined(name).then(() => {}), timeout(8000)])
    Promise.all([
      loadScript('mab-support', `${MAB_BASE}/embed/support.js`),
      loadScript('mab-ideas',   `${MAB_BASE}/embed/ideas.js`),
    ]).then(() => Promise.all([
      whenDefinedOrTimeout('myappbuddy-support'),
      whenDefinedOrTimeout('myappbuddy-ideas'),
    ])).then(() => setScriptsReady(true))
  }, [scriptsReady])

  const ready = scriptsReady && !!user

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: 'calc(56px + var(--safe-bottom))' }}>
      <div style={{
        padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'var(--color-surface)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Help &amp; feedback</h1>
      </div>

      <div style={{ maxWidth: 600, margin: '0 auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {!ready ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.875rem' }}>Loading…</div>
        ) : (
          <>
            <section>
              <h2 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>
                Support tickets
              </h2>
              {React.createElement('myappbuddy-support', {
                'app-id': 'companion',
                'app-ref': userEmail,
                'user-email': userEmail,
                'user-name': userName,
                'app-name': 'Companion',
                'base-url': MAB_BASE,
                accent: '#6f8c78',
                style: { display: 'block' },
              })}
            </section>

            <section>
              <h2 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>
                Ideas &amp; roadmap
              </h2>
              {React.createElement('myappbuddy-ideas', {
                'app-id': 'companion',
                'user-email': userEmail,
                'user-name': userName,
                'app-name': 'Companion',
                'base-url': MAB_BASE,
                accent: '#6f8c78',
                style: { display: 'block' },
              })}
            </section>
          </>
        )}

        <MobileFooter />
      </div>
    </div>
  )
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'myappbuddy-support': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, string>
      'myappbuddy-ideas': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, string>
    }
  }
}
