import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { MobileFooter } from '../components/SiteFooter'
import { WidgetBoundary } from '../components/WidgetBoundary'
import { MabEmbed } from '../components/MabEmbed'

const MAB_BASE = 'https://myappbuddy.com.au'

function WidgetUnavailable({ label }: { label: string }) {
  return (
    <div style={{ padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
      {label} isn't available right now. You can email <a href="mailto:hello@myappbuddy.com.au" style={{ color: 'var(--color-primary)' }}>hello@myappbuddy.com.au</a>.
    </div>
  )
}

// The MAB embed scripts are loaded eagerly from index.html (static <script defer>
// tags). The custom elements register on their own and auto-upgrade any matching
// tags already in the DOM, and each element renders its own header, form, list,
// and loading/empty/error states — so we just drop them in. We only wait on
// whenDefined to show a brief spinner instead of a flash of empty elements; we do
// NOT show a hard "couldn't load" fallback, which previously masked working widgets.
export default function Feedback() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [ready, setReady] = useState(
    () => !!customElements.get('myappbuddy-support') && !!customElements.get('myappbuddy-ideas')
  )

  const userEmail = user?.email ?? ''
  const userName = profile?.full_name ?? ''

  useEffect(() => {
    if (ready) return
    let alive = true
    Promise.all([
      customElements.whenDefined('myappbuddy-support'),
      customElements.whenDefined('myappbuddy-ideas'),
    ]).then(() => { if (alive) setReady(true) })
    return () => { alive = false }
  }, [ready])

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
              <WidgetBoundary fallback={<WidgetUnavailable label="Support" />}>
                <MabEmbed tag="myappbuddy-support" attrs={{
                  'app-id': 'companion',
                  'app-ref': userEmail,
                  'user-email': userEmail,
                  'user-name': userName,
                  'app-name': 'Companion',
                  'base-url': MAB_BASE,
                  accent: '#6f8c78',
                }} />
              </WidgetBoundary>
            </section>

            <section>
              <h2 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>
                Ideas &amp; roadmap
              </h2>
              <WidgetBoundary fallback={<WidgetUnavailable label="Ideas & roadmap" />}>
                <MabEmbed tag="myappbuddy-ideas" attrs={{
                  'app-id': 'companion',
                  'app-name': 'Companion',
                  'base-url': MAB_BASE,
                  accent: '#6f8c78',
                }} />
              </WidgetBoundary>
            </section>
          </>
        )}

        <MobileFooter />
      </div>
    </div>
  )
}
