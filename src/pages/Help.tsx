import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  cachedHelpList, fetchHelpList, filterGroupsForApp, filterGroupsByRole,
  cachedHelpArticle, fetchHelpArticle,
  type HelpGroup, type HelpArticleFull,
} from '../lib/help'

/* Minimal markdown renderer for article bodies. Handles the subset the help API
   emits: ## headings, - bullet lists, **bold** inline, and blank-line paragraphs.
   Content is from our own trusted API; we still build React nodes (no innerHTML). */
function inline(text: string, keyBase: string) {
  return text.split('**').map((part, i) =>
    i % 2 === 1 ? <strong key={`${keyBase}-${i}`}>{part}</strong> : <span key={`${keyBase}-${i}`}>{part}</span>
  )
}

function Markdown({ body }: { body: string }) {
  const blocks: React.ReactNode[] = []
  const lines = body.split('\n')
  let list: string[] = []
  const flushList = (k: string) => {
    if (!list.length) return
    blocks.push(
      <ul key={k} style={{ margin: '0 0 0.75rem', paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {list.map((li, i) => <li key={i} style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>{inline(li, `${k}-${i}`)}</li>)}
      </ul>
    )
    list = []
  }
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      flushList(`l${idx}`)
      blocks.push(<h2 key={idx} style={{ fontSize: '0.95rem', fontWeight: 700, margin: '1rem 0 0.4rem' }}>{inline(line.slice(3), `h${idx}`)}</h2>)
    } else if (line.startsWith('- ')) {
      list.push(line.slice(2))
    } else if (line.trim() === '') {
      flushList(`l${idx}`)
    } else {
      flushList(`l${idx}`)
      blocks.push(<p key={idx} style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--color-text)' }}>{inline(line, `p${idx}`)}</p>)
    }
  })
  flushList('end')
  return <>{blocks}</>
}

const headerStyle: React.CSSProperties = {
  padding: '0.875rem 1rem', borderBottom: '1px solid var(--color-border)',
  display: 'flex', alignItems: 'center', gap: '0.75rem',
  position: 'sticky', top: 0, background: 'var(--color-bg)', zIndex: 10,
}

/* ── Article reader (route /help/:slug) ─────────────────────────────── */
function HelpArticleView({ slug }: { slug: string }) {
  const navigate = useNavigate()
  const [article, setArticle] = useState<HelpArticleFull | null>(() => cachedHelpArticle(slug))
  const [loading, setLoading] = useState(!article)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setError(false)
    fetchHelpArticle(slug).then((a) => {
      if (!alive) return
      if (a) setArticle(a)
      else if (!cachedHelpArticle(slug)) setError(true)
      setLoading(false)
    })
    return () => { alive = false }
  }, [slug])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={headerStyle}>
        <button className="btn btn-ghost" onClick={() => navigate('/help')}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {article?.title ?? 'Help'}
        </h1>
      </div>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
        {article ? (
          <>
            {article.category && (
              <p style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>
                {article.category}
              </p>
            )}
            <h2 style={{ margin: '0 0 1rem', fontSize: '1.25rem', fontFamily: 'var(--font-display)', fontWeight: 600 }}>{article.title}</h2>
            <Markdown body={article.body} />
          </>
        ) : loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.875rem' }}>Loading…</div>
        ) : error ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.875rem' }}>
            Couldn't load this article. <button className="btn btn-ghost" onClick={() => navigate('/help')} style={{ fontSize: '0.875rem' }}>Back to help</button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ── Article list (route /help) ─────────────────────────────────────── */
function HelpList() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const role = profile?.role
  const [groups, setGroups] = useState<HelpGroup[] | null>(() => cachedHelpList(role))
  const [loading, setLoading] = useState(!groups)

  useEffect(() => {
    let alive = true
    fetchHelpList(role).then((res) => {
      if (!alive) return
      if (res && (res.changed || !groups)) setGroups(res.groups)
      setLoading(false)
    })
    return () => { alive = false }
  }, [role]) // eslint-disable-line react-hooks/exhaustive-deps

  // Companion-only articles, then tailored to the signed-in role (role filter is
  // a no-op until MAB tags articles with `roles`).
  const visibleGroups = useMemo(
    () => (groups ? filterGroupsByRole(filterGroupsForApp(groups), role) : null),
    [groups, role],
  )
  const isEmpty = useMemo(() => !!visibleGroups && visibleGroups.every((g) => !g.articles?.length), [visibleGroups])

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--color-bg)', paddingBottom: '3rem' }}>
      <div style={headerStyle}>
        <button className="btn btn-ghost" onClick={() => navigate(-1)}
          style={{ fontSize: '0.875rem', padding: '0.25rem 0.5rem' }}>←</button>
        <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Help</h1>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '1rem' }}>
        {/* Tickets + ideas up top, so support is the first thing you can reach. */}
        <button className="card" onClick={() => navigate('/feedback')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', width: '100%', textAlign: 'left', marginBottom: '1.25rem', cursor: 'pointer', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
          <span>
            <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9375rem' }}>Support tickets &amp; ideas</span>
            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>Open a support ticket or share a feature idea.</span>
          </span>
          <span aria-hidden="true" style={{ color: 'var(--color-muted)', fontSize: '1.1rem' }}>→</span>
        </button>

        {!visibleGroups && loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.875rem' }}>Loading…</div>
        ) : !visibleGroups || isEmpty ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-muted)', fontSize: '0.875rem' }}>
            No help articles yet. Need a hand? <a href="mailto:hello@myappbuddy.com.au" style={{ color: 'var(--color-primary)' }}>hello@myappbuddy.com.au</a>
          </div>
        ) : (
          visibleGroups.filter((g) => g.articles?.length).map((g) => (
            <section key={g.category} style={{ marginBottom: '1.25rem' }}>
              <p style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-muted)', margin: '0 0 0.5rem' }}>
                {g.category}
              </p>
              {g.articles.map((a) => (
                <button key={a.slug} className="card" onClick={() => navigate(`/help/${a.slug}`)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: '0.5rem', cursor: 'pointer', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
                  <p style={{ margin: '0 0 0.2rem', fontWeight: 600, fontSize: '0.9375rem' }}>{a.title}</p>
                  {a.summary && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-muted)', lineHeight: 1.5 }}>{a.summary}</p>}
                </button>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}

export default function Help() {
  const { slug } = useParams()
  return slug ? <HelpArticleView slug={slug} /> : <HelpList />
}
