// Help articles come from the MyAppBuddy platform (there is no help web
// component — it's a JSON API). We cache responses in localStorage and use a
// stale-while-revalidate pattern: callers render the cached copy instantly,
// then a background fetch updates it if the content changed.
//
//   GET /api/v1/help?app_id=companion → { groups: [{ category, articles[] }] }
//   GET /api/v1/help/:slug            → { article: { …, body } }
// CORS allows companion.myappbuddy.com.au.

const BASE = 'https://myappbuddy.com.au/api/v1/help'
const LIST_KEY = 'companion-help-list-v1'
const ART_KEY = (slug: string) => `companion-help-article-${slug}-v1`

export type HelpArticle = {
  slug: string
  category: string
  title: string
  summary: string
  planLabel?: string
  appId?: string | null
  audience?: string
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
export function cachedHelpList(): HelpGroup[] | null {
  return readCache<HelpGroup[]>(LIST_KEY)
}

/**
 * Fetch the latest article list and cache it. Returns the fresh groups, or
 * `changed: false` when the payload matches what was already cached so callers
 * can skip a re-render.
 */
export async function fetchHelpList(): Promise<{ groups: HelpGroup[]; changed: boolean } | null> {
  try {
    const res = await fetch(`${BASE}?app_id=companion`, { headers: { accept: 'application/json' } })
    if (!res.ok) return null
    const data = await res.json()
    const groups: HelpGroup[] = Array.isArray(data?.groups) ? data.groups : []
    const prev = localStorage.getItem(LIST_KEY)
    const next = JSON.stringify(groups)
    writeCache(LIST_KEY, groups)
    return { groups, changed: prev !== next }
  } catch {
    return null
  }
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
