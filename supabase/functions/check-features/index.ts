import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Fail closed everywhere: any error, or a subscription the hub hasn't decided
// on, yields an EMPTY feature list. The app must treat "not in this list" as
// "not included" — never as "allowed". MyAppBuddy is the single source of
// truth for which plan includes which feature; this function only reads it.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ features: [], plan: null, status: null })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, db: { schema: 'companion' } },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return json({ features: [], plan: null, status: null })

    const mabUrl = Deno.env.get('MAB_API_URL') ?? 'https://myappbuddy.com.au'
    const serviceKey = Deno.env.get('MAB_SECRET_KEY')
      || Deno.env.get('COMPANION_SERVICE_KEY') || ''
    const readKey = Deno.env.get('MAB_PUBLISHABLE_KEY') || serviceKey

    let subscriptionId: string | null = null
    let plan: string | null = null
    let status: string | null = null

    // 1a. Prefer the caller's ORG subscription so every org member (workers,
    //     family, recipient — not just the owner) resolves the same
    //     entitlements. Read with the service role so RLS can't hide it.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'companion' } },
    )
    const { data: profile } = await admin
      .from('profiles').select('org_id').eq('id', user.id).maybeSingle()
    if (profile?.org_id) {
      const { data: org } = await admin
        .from('organisations')
        .select('myappbuddy_subscription_id, billing_status')
        .eq('id', profile.org_id)
        .maybeSingle()
      if (org?.myappbuddy_subscription_id && ['active', 'trial', 'trialing'].includes(org.billing_status ?? '')) {
        subscriptionId = org.myappbuddy_subscription_id
        status = org.billing_status ?? null
      }
    }

    // 1b. Fallback: resolve by the caller's own email.
    if (!subscriptionId) {
      const subRes = await fetch(
        `${mabUrl}/api/v1/apps/companion/subscription/check?email=${encodeURIComponent(user.email)}`,
        { headers: { Authorization: `Bearer ${serviceKey}` } },
      )
      if (!subRes.ok) return json({ features: [], plan: null, status: null })
      const sub = await subRes.json()
      subscriptionId = sub?.subscription_id ?? null
      plan = sub?.plan ?? null
      status = sub?.status ?? null
      if (!subscriptionId || !['active', 'trialing', 'trial'].includes(status ?? '')) {
        return json({ features: [], plan, status })
      }
    }

    // 2. Ask the hub which features this subscription includes.
    const featRes = await fetch(
      `${mabUrl}/api/v1/subscriptions/${encodeURIComponent(subscriptionId)}/features`,
      { headers: { Authorization: `Bearer ${readKey}` } },
    )
    if (!featRes.ok) return json({ features: [], plan, status })

    let data: unknown = null
    try { data = await featRes.json() } catch { data = null }

    // MyAppBuddy returns an OBJECT MAP of app-prefixed keys to their value:
    //   { "companion.mood_tracking": true, "companion.participants": "Free", ... }
    // A boolean `true` means included; `false` means not. Non-boolean values
    // (e.g. "Free") are tier/quota labels, not on/off gates. Also accept the
    // older shapes ({features:[...]}, {included:[...]}, or a bare array).
    const dataObj = data as Record<string, unknown> | null
    let raw: unknown[]
    if (Array.isArray(data)) {
      raw = data
    } else if (Array.isArray(dataObj?.features)) {
      raw = dataObj!.features as unknown[]
    } else if (Array.isArray(dataObj?.included)) {
      raw = dataObj!.included as unknown[]
    } else if (dataObj && typeof dataObj === 'object') {
      raw = Object.entries(dataObj).filter(([, v]) => v === true).map(([k]) => k)
    } else {
      raw = []
    }

    // Normalise to bare keys: unwrap {key}, drop the leading "companion." app
    // prefix, discard empties.
    const features = raw
      .map((f) => (typeof f === 'string' ? f : (f as { key?: string })?.key))
      .filter((k): k is string => typeof k === 'string' && k.length > 0)
      .map((k) => k.replace(/^companion\./, ''))
      .filter((k) => k.length > 0)

    return json({ features, plan, status })
  } catch {
    return json({ features: [], plan: null, status: null })
  }
})
