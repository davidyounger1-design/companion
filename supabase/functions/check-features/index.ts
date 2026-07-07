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
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return json({ features: [], plan: null, status: null })

    const mabUrl = Deno.env.get('MAB_API_URL') ?? 'https://myappbuddy.com.au'
    const serviceKey = Deno.env.get('COMPANION_SERVICE_KEY') ?? ''
    // Publishable key is what the hub expects for reading a subscription's
    // features; fall back to the service key server-side if not separately set.
    const readKey = Deno.env.get('MAB_PUBLISHABLE_KEY') || serviceKey

    // 1. Resolve the caller's subscription from their email (same lookup as
    //    check-plan — we never trust a client-supplied subscription id).
    const subRes = await fetch(
      `${mabUrl}/api/v1/apps/companion/subscription/check?email=${encodeURIComponent(user.email)}`,
      { headers: { Authorization: `Bearer ${serviceKey}` } },
    )
    if (!subRes.ok) return json({ features: [], plan: null, status: null })
    const sub = await subRes.json()
    const subscriptionId: string | null = sub?.subscription_id ?? null
    const plan: string | null = sub?.plan ?? null
    const status: string | null = sub?.status ?? null

    if (!subscriptionId || !['active', 'trialing'].includes(status ?? '')) {
      return json({ features: [], plan, status })
    }

    // 2. Ask the hub which features this subscription includes.
    const featRes = await fetch(
      `${mabUrl}/api/v1/subscriptions/${encodeURIComponent(subscriptionId)}/features`,
      { headers: { Authorization: `Bearer ${readKey}` } },
    )
    if (!featRes.ok) return json({ features: [], plan, status })

    const data = await featRes.json()
    // Be tolerant of the exact response shape: {features:[...]}, {included:[...]},
    // or a bare array; entries may be strings or {key}.
    const raw: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray(data?.features) ? data.features
      : Array.isArray(data?.included) ? data.included
      : []
    const features = raw
      .map((f) => (typeof f === 'string' ? f : (f as { key?: string })?.key))
      .filter((k): k is string => typeof k === 'string' && k.length > 0)

    return json({ features, plan, status })
  } catch {
    return json({ features: [], plan: null, status: null })
  }
})
