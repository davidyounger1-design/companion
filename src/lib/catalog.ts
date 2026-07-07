// ─────────────────────────────────────────────────────────────
// Plan catalog — single display source
//
// MyAppBuddy is the source of truth for plan names, prices and per-plan
// feature lists. Both the marketing pricing table (Landing) and the in-app
// plan picker (Step2Plan) read the SAME live catalog through here, so pricing
// is defined in exactly one place. If the hub is unreachable we fall back to a
// single hard-coded snapshot (also defined once, below) so the pages still
// render — never a second, drifting copy per page.
// ─────────────────────────────────────────────────────────────

const CATALOG_URL = 'https://myappbuddy.com.au/api/v1/catalog'
export const APP_ID = 'companion'

/** A plan exactly as the hub catalog describes it. Prices are in cents. */
export interface CatalogPlan {
  id: string
  appId: string
  name: string
  blurb: string
  priceMonth: number | null
  priceYear: number | null
  perSeat: boolean
  popular: boolean
  features: string[]
  sort?: number
  archived?: boolean
  hidden?: boolean
}

// Only used when the hub can't be reached. Keep this the ONLY hard-coded
// pricing anywhere in the app.
const FALLBACK: CatalogPlan[] = [
  { id: 'companion_family',  appId: APP_ID, name: 'Family',  blurb: "Stay connected to your loved one's care — forever free.", priceMonth: 0,    priceYear: 0,     perSeat: false, popular: false, features: ['Daily digest & timeline', 'Conversation starters', 'Messaging with the team', 'Control who sees what', "A login for your loved one, if they'd like one"], sort: 0 },
  { id: 'companion_solo',    appId: APP_ID, name: 'Solo',    blurb: 'Perfect for sole traders and tiny teams.',              priceMonth: 2900, priceYear: 29200, perSeat: false, popular: false, features: ['3 active participants', 'Unlimited workers', 'Family digest', 'Behaviour notes', 'NDIS-ready records'], sort: 1 },
  { id: 'companion_starter', appId: APP_ID, name: 'Starter', blurb: 'For growing providers with a proper team.',             priceMonth: 4900, priceYear: 49200, perSeat: false, popular: true,  features: ['10 active participants', 'Unlimited workers', 'Everything in Solo', 'Shared therapy circles', 'Priority support'], sort: 2 },
  { id: 'companion_team',    appId: APP_ID, name: 'Team',    blurb: 'Scales with your caseload — no cap.',                    priceMonth: 700,  priceYear: 7056,  perSeat: true,  popular: false, features: ['Unlimited participants', 'Unlimited workers', 'Everything in Starter', 'Usage billing (NDIS-ready)', 'Dedicated onboarding'], sort: 3 },
]

/**
 * Fetch the live plan catalog for this app, filtered to visible (non-archived,
 * non-hidden) plans and sorted by the hub's `sort` order. Returns the fallback
 * snapshot if the hub is unreachable or returns nothing. Callers apply their
 * own inclusion rules (e.g. the plan picker drops the free & enterprise tiers).
 */
export async function fetchCatalog(): Promise<CatalogPlan[]> {
  try {
    const res = await fetch(`${CATALOG_URL}?app=${APP_ID}&currency=AUD`)
    if (!res.ok) return FALLBACK
    const data = await res.json()
    const plans: CatalogPlan[] = (data?.plans ?? [])
      .filter((p: CatalogPlan) => p.appId === APP_ID && !p.archived && !p.hidden)
      .sort((a: CatalogPlan, b: CatalogPlan) => (a.sort ?? 0) - (b.sort ?? 0))
    return plans.length ? plans : FALLBACK
  } catch {
    return FALLBACK
  }
}
