import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Show a key's TYPE and length without leaking it: "sk_…(48)" / "pk_…(41)".
// Enough to spot a missing/swapped/wrong-type key; not enough to be a secret.
function maskKey(k: string | undefined): string {
  if (!k) return 'ABSENT'
  return `${k.slice(0, 3)}…(${k.length})`
}

// Fail closed everywhere: any error, or a subscription the hub hasn't decided
// on, yields an EMPTY feature list. The app must treat "not in this list" as
// "not included" — never as "allowed". MyAppBuddy is the single source of
// truth for which plan includes which feature; this function only reads it.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // TEMPORARY diagnostics: every exit carries a `_debug` object describing what
  // MyAppBuddy actually returned, so a stuck plan / empty feature list can be
  // traced to the exact upstream call. Safe to strip once resolved.
  const debug: Record<string, unknown> = {}
  const json = (body: Record<string, unknown>) =>
    new Response(JSON.stringify({ ...body, _debug: debug }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) { debug.stop = 'no-auth-header'; return json({ features: [], plan: null, status: null }) }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) { debug.stop = 'no-user'; return json({ features: [], plan: null, status: null }) }

    const mabUrl = Deno.env.get('MAB_API_URL') ?? 'https://myappbuddy.com.au'
    const serviceKey = Deno.env.get('MAB_SECRET_KEY')
      || Deno.env.get('COMPANION_SERVICE_KEY') || ''
    const readKey = Deno.env.get('MAB_PUBLISHABLE_KEY') || serviceKey

    debug.keys = {
      MAB_SECRET_KEY: maskKey(Deno.env.get('MAB_SECRET_KEY')),
      COMPANION_SERVICE_KEY: maskKey(Deno.env.get('COMPANION_SERVICE_KEY')),
      MAB_PUBLISHABLE_KEY: maskKey(Deno.env.get('MAB_PUBLISHABLE_KEY')),
      serviceKeyUsed: maskKey(serviceKey || undefined),
      readKeyUsed: maskKey(readKey || undefined),
    }
    debug.email = user.email

    // Probe: what does the email-based subscription check return? (Independent
    // of the org path below, so we always learn whether MAB knows this email.)
    try {
      const r = await fetch(
        `${mabUrl}/api/v1/apps/companion/subscription/check?email=${encodeURIComponent(user.email)}`,
        { headers: { Authorization: `Bearer ${serviceKey}` } },
      )
      debug.subscriptionCheck = { httpStatus: r.status, body: (await r.text()).slice(0, 300) }
    } catch (e) { debug.subscriptionCheck = { error: String(e) } }

    let subscriptionId: string | null = null
    let plan: string | null = null
    let status: string | null = null

    // 1a. Prefer the caller's ORG subscription so every org member resolves the
    //     same entitlements (service role read so RLS can't hide it).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: profile } = await admin
      .from('profiles').select('org_id').eq('id', user.id).maybeSingle()
    if (profile?.org_id) {
      const { data: org } = await admin
        .from('organisations')
        .select('myappbuddy_subscription_id, billing_status')
        .eq('id', profile.org_id)
        .maybeSingle()
      debug.org = { subscription_id: org?.myappbuddy_subscription_id ?? null, billing_status: org?.billing_status ?? null }
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
      if (!subRes.ok) { debug.stop = `subscription-check-not-ok:${subRes.status}`; return json({ features: [], plan: null, status: null }) }
      const sub = await subRes.json()
      subscriptionId = sub?.subscription_id ?? null
      plan = sub?.plan ?? null
      status = sub?.status ?? null
      if (!subscriptionId || !['active', 'trialing', 'trial'].includes(status ?? '')) {
        debug.stop = 'no-active-subscription-by-email'
        return json({ features: [], plan, status })
      }
    }

    debug.resolvedSubscriptionId = subscriptionId

    // 2. Ask the hub which features this subscription includes.
    const featRes = await fetch(
      `${mabUrl}/api/v1/subscriptions/${encodeURIComponent(subscriptionId)}/features`,
      { headers: { Authorization: `Bearer ${readKey}` } },
    )
    const featBodyText = await featRes.text()
    debug.featuresCall = { httpStatus: featRes.status, body: featBodyText.slice(0, 400) }
    if (!featRes.ok) { debug.stop = `features-not-ok:${featRes.status}`; return json({ features: [], plan, status }) }

    let data: unknown = null
    try { data = JSON.parse(featBodyText) } catch { data = null }
    const dataObj = data as { features?: unknown[]; included?: unknown[] } | null
    const raw: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray(dataObj?.features) ? dataObj!.features
      : Array.isArray(dataObj?.included) ? dataObj!.included
      : []
    const features = raw
      .map((f) => (typeof f === 'string' ? f : (f as { key?: string })?.key))
      .filter((k): k is string => typeof k === 'string' && k.length > 0)

    return json({ features, plan, status })
  } catch (e) {
    debug.error = String(e)
    return json({ features: [], plan: null, status: null })
  }
})
