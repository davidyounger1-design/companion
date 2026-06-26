import { useNavigate } from 'react-router-dom'

const APP_VERSION = '0.2.0'

const RELEASES = [
  {
    version: '0.2.0',
    date: '27 June 2026',
    title: 'Mood tracking, media, messaging & more',
    changes: [
      { type: 'new', text: 'Mood meter on every journal entry — rate from 😔 to 😊' },
      { type: 'new', text: 'Mood tracker chart on dashboard — visualise mood over time' },
      { type: 'new', text: 'Notice board — post important notices visible to the whole care team' },
      { type: 'new', text: 'Messaging — direct chat between workers and coordinator; family group thread' },
      { type: 'new', text: 'Video uploads — attach a short video to any journal entry' },
      { type: 'new', text: 'Full-screen media viewer — tap any photo or video to expand' },
      { type: 'new', text: 'Click-to-edit journal entries for coordinator, family, and workers (own entries)' },
      { type: 'new', text: 'Resend invite link for pending members' },
      { type: 'new', text: 'Permissions matrix — coordinators can configure what each role can do' },
      { type: 'fix', text: 'Workers now only see their own journal entries' },
      { type: 'fix', text: 'Removing a member now deletes their login account' },
      { type: 'fix', text: 'Sign out button label was truncated — now shows "Sign out" in full' },
      { type: 'fix', text: 'Photo button did nothing on desktop — now opens file picker correctly' },
    ],
  },
  {
    version: '0.1.0',
    date: '26 June 2026',
    title: 'Initial release',
    changes: [
      { type: 'new', text: 'Family journal with Meal, Activity, Mood, Note entry types' },
      { type: 'new', text: 'Invite-based onboarding — click link, set password, land in journal' },
      { type: 'new', text: 'Worker portal with client list and shift logging' },
      { type: 'new', text: 'Coordinator dashboard with member management' },
      { type: 'new', text: 'Photo attachment on all entry types' },
      { type: 'new', text: 'Author attribution on all journal entries' },
    ],
  },
]

const TYPE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: 'New', color: '#2e7d52', bg: '#e8f5ee' },
  fix: { label: 'Fix', color: '#c06b1a', bg: '#fef3e2' },
  change: { label: 'Changed', color: '#5b5ea6', bg: '#efeffd' },
}

export { APP_VERSION }

export default function ReleaseNotes() {
  const navigate = useNavigate()

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={{
        padding: '1rem 1rem 0.75rem',
        borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0,
        background: 'var(--color-bg)', zIndex: 10,
        display: 'flex', alignItems: 'center', gap: '0.75rem',
      }}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <div>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Release notes</h1>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', margin: 0 }}>
            Companion v{APP_VERSION}
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '1.5rem 1rem' }}>
        {RELEASES.map((rel) => (
          <div key={rel.version} style={{ marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>v{rel.version}</h2>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{rel.date}</span>
              {rel.version === APP_VERSION && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.06em',
                  textTransform: 'uppercase', background: 'var(--color-primary)', color: '#fff',
                  padding: '0.1rem 0.4rem', borderRadius: 4,
                }}>current</span>
              )}
            </div>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>{rel.title}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {rel.changes.map((c, i) => {
                const badge = TYPE_BADGE[c.type] ?? TYPE_BADGE.change
                return (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <span style={{
                      flexShrink: 0, fontSize: '0.65rem', fontWeight: 700,
                      padding: '0.15rem 0.45rem', borderRadius: 4,
                      background: badge.bg, color: badge.color,
                      letterSpacing: '0.04em', textTransform: 'uppercase', marginTop: 2,
                    }}>{badge.label}</span>
                    <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.5 }}>{c.text}</p>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
