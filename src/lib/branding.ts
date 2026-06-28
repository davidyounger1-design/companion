// Pulls this product's resolved theme from the MyAppBuddy platform and applies
// it as CSS custom properties on :root, so Companion follows the branding set in
// the MAB product/theme editor (accent colour, corner radius, typography) instead
// of hardcoding its own look.
//
// MAB serves ready-to-apply CSS vars at GET /api/v1/branding/companion → cssVars:
//   --accent, --accent-strong, --accent-press, --accent-soft, --accent-soft-2,
//   --accent-ring, --r-sm, --r, --r-lg, --r-xl, --ff-display, --ff-sans
// index.css maps those onto Companion's own semantic tokens (--color-primary,
// --radius*, --font-*) with the original values kept as fallbacks, so first paint
// and offline both render the built-in sage theme until/unless the API answers.

const BRANDING_URL = 'https://myappbuddy.com.au/api/v1/branding/companion'
const CACHE_KEY = 'mab-branding-cssvars-v1'

// Named webfonts MAB's typography picker can return. System stacks need no load.
const WEBFONTS: Record<string, string> = {
  'Hanken Grotesk': 'Hanken+Grotesk:wght@400;500;600;700',
  'Space Grotesk':  'Space+Grotesk:wght@400;500;600;700',
}

function ensureFonts(vars: Record<string, string>) {
  const stacks = [vars['--ff-display'], vars['--ff-sans']].filter(Boolean)
  for (const [family, spec] of Object.entries(WEBFONTS)) {
    const id = `gf-${family.replace(/\s+/g, '-').toLowerCase()}`
    if (stacks.some((s) => s.includes(family)) && !document.getElementById(id)) {
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`
      document.head.appendChild(link)
    }
  }
}

function applyVars(vars: Record<string, string>) {
  const root = document.documentElement
  for (const [k, v] of Object.entries(vars)) {
    if (k.startsWith('--') && typeof v === 'string') root.style.setProperty(k, v)
  }
  ensureFonts(vars)
}

/** Apply last-known branding synchronously from cache. Call before React renders. */
export function applyCachedBranding(): void {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) applyVars(JSON.parse(raw))
  } catch {
    /* malformed cache — fall back to built-in theme */
  }
}

/** Fetch the latest branding, apply it, and cache for next launch. Non-blocking. */
export async function refreshBranding(): Promise<void> {
  try {
    const res = await fetch(BRANDING_URL, { headers: { accept: 'application/json' } })
    if (!res.ok) return
    const data = await res.json()
    const vars = data?.cssVars
    if (vars && typeof vars === 'object') {
      applyVars(vars)
      localStorage.setItem(CACHE_KEY, JSON.stringify(vars))
    }
  } catch {
    /* offline or network error — keep cached/built-in theme */
  }
}
