// Help articles come from the MyAppBuddy platform (there is no help web
// component — it's a JSON API). We cache responses in localStorage and use a
// stale-while-revalidate pattern: callers render the cached copy instantly,
// then a background fetch updates it if the content changed.
//
//   GET /api/v1/help?app_id=companion → { groups: [{ category, articles[] }] }
//   GET /api/v1/help/:slug            → { article: { …, body } }
// CORS allows companion.myappbuddy.com.au.

const BASE = 'https://myappbuddy.com.au/api/v1/help'
// Cache is keyed by role so a future server-side ?role= filter caches correctly.
const LIST_KEY = (role?: string) => `companion-help-list-${role || 'all'}-v1`
const ART_KEY = (slug: string) => `companion-help-article-${slug}-v1`

export type HelpArticle = {
  slug: string
  category: string
  title: string
  summary: string
  planLabel?: string
  appId?: string | null
  audience?: string
  // Platform role tags. Empty/absent = applies to all roles. MAB is expected to
  // emit an array; we also accept a comma-separated string defensively.
  roles?: string[] | string
}
export type HelpGroup = { category: string; articles: HelpArticle[] }
export type HelpArticleFull = HelpArticle & { body: string }

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeCache(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota or private mode — caching is best-effort */
  }
}

/** Last-known article list from cache (sync, no network). */
export function cachedHelpList(role?: string): HelpGroup[] | null {
  return readCache<HelpGroup[]>(LIST_KEY(role))
}

/**
 * Fetch the latest article list and cache it. Returns the fresh groups, or
 * `changed: false` when the payload matches what was already cached so callers
 * can skip a re-render. Passes ?role= so MAB can filter server-side once it
 * supports it; harmless today (unknown params are ignored).
 */
export async function fetchHelpList(role?: string): Promise<{ groups: HelpGroup[]; changed: boolean } | null> {
  try {
    const url = `${BASE}?app_id=companion${role ? `&role=${encodeURIComponent(role)}` : ''}`
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    const groups: HelpGroup[] = Array.isArray(data?.groups) ? data.groups : []
    const key = LIST_KEY(role)
    const prev = localStorage.getItem(key)
    const next = JSON.stringify(groups)
    writeCache(key, groups)
    return { groups, changed: prev !== next }
  } catch {
    return null
  }
}

/** Role tags for an article, normalized to a string[] (empty = applies to all). */
function rolesOf(a: HelpArticle): string[] {
  const r = a.roles
  if (!r) return []
  return (Array.isArray(r) ? r : String(r).split(',')).map((s) => s.trim()).filter(Boolean)
}

/**
 * Forward-compatible client-side role filter. Keeps articles whose role tags are
 * empty/absent (apply to everyone) or include the given role; drops emptied
 * groups. A no-op today because MAB doesn't emit `roles` yet — every article has
 * no tags, so all pass — and it activates automatically once tags appear.
 */
export function filterGroupsByRole(groups: HelpGroup[], role?: string): HelpGroup[] {
  if (!role) return groups
  return groups
    .map((g) => ({ ...g, articles: (g.articles ?? []).filter((a) => {
      const roles = rolesOf(a)
      return roles.length === 0 || roles.includes(role)
    }) }))
    .filter((g) => g.articles.length > 0)
}

/** Last-known full article from cache (sync, no network). */
export function cachedHelpArticle(slug: string): HelpArticleFull | null {
  return readCache<HelpArticleFull>(ART_KEY(slug))
}

/** Fetch a full article (with body) and cache it. */
export async function fetchHelpArticle(slug: string): Promise<HelpArticleFull | null> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(slug)}`, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    const article = data?.article as HelpArticleFull | undefined
    if (article?.slug) {
      writeCache(ART_KEY(slug), article)
      return article
    }
    return null
  } catch {
    return null
  }
}
