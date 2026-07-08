// Registers `app_ref` on a MyAppBuddy subscription so MAB's trust-boundary
// check (used to gate idea voting/commenting and ticket replies in the
// embedded widgets) can match the signed-in user to their subscription.
// Without this, every embed write call 403s even for real, paying
// subscribers — MAB_SECRET_KEY is a server-side-only secret (Edge Function
// env var via `supabase secrets set`), never exposed to the client.

const MAB_API_BASE = 'https://myappbuddy.com.au/api/v1'

export async function registerAppRef(subscriptionId: string, email: string): Promise<boolean> {
  const secretKey = Deno.env.get('MAB_SECRET_KEY') || Deno.env.get('COMPANION_SERVICE_KEY')
  if (!secretKey || !subscriptionId || !email) return false
  try {
    const res = await fetch(`${MAB_API_BASE}/link/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orgId: email }),
    })
    if (!res.ok) {
      console.error('registerAppRef failed:', res.status, await res.text().catch(() => ''))
      return false
    }
    return true
  } catch (e) {
    console.error('registerAppRef error:', e)
    return false
  }
}

/** Fallback lookup for when we don't already have a subscription id on file
 * — matches by the account owner's email against MAB's subscription list. */
export async function findSubscriptionIdByEmail(email: string): Promise<string | null> {
  const secretKey = Deno.env.get('MAB_SECRET_KEY') || Deno.env.get('COMPANION_SERVICE_KEY')
  if (!secretKey || !email) return null
  try {
    const res = await fetch(`${MAB_API_BASE}/link/subscriptions?app=companion&status=all`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    const subs = Array.isArray(data) ? data : (data?.subscriptions ?? [])
    const match = subs.find(
      (s: { ownerEmail?: string; id?: string }) => s.ownerEmail?.toLowerCase() === email.toLowerCase()
    )
    return match?.id ?? null
  } catch (e) {
    console.error('findSubscriptionIdByEmail error:', e)
    return null
  }
}
