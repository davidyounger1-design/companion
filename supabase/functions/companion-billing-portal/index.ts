import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mints a one-time magic-login URL into the caller's MyAppBuddy billing portal,
// where they can upgrade/downgrade/cancel and view invoices/payment methods —
// MAB owns all the billing-sensitive logic, we just open the door. Auth mirrors
// check-plan: authenticate the caller via their Supabase session, resolve their
// org's stored MAB subscription id (service role, so RLS can't hide it), then
// POST to the hub's portal endpoint with the server secret key.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ url: null, error: 'unauthorized' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ url: null, error: 'unauthorized' }, 401)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: profile } = await admin
      .from('profiles').select('org_id').eq('id', user.id).maybeSingle()
    if (!profile?.org_id) return json({ url: null, error: 'no-org' })
    const { data: org } = await admin
      .from('organisations')
      .select('myappbuddy_subscription_id')
      .eq('id', profile.org_id)
      .maybeSingle()
    const subId = org?.myappbuddy_subscription_id
    if (!subId) return json({ url: null, error: 'no-subscription' })

    const mabUrl = Deno.env.get('MAB_API_URL') ?? 'https://myappbuddy.com.au'
    const key = Deno.env.get('MAB_SECRET_KEY') || Deno.env.get('COMPANION_SERVICE_KEY') || ''

    const res = await fetch(
      `${mabUrl}/api/v1/link/subscriptions/${encodeURIComponent(subId)}/portal`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: 'https://companion.myappbuddy.com.au/account' }),
      },
    )
    if (!res.ok) return json({ url: null, error: `portal-${res.status}` })
    const data = await res.json().catch(() => ({}))
    const url: string | null = data?.url ?? data?.portalUrl ?? data?.portal_url ?? null
    return json({ url })
  } catch (e) {
    return json({ url: null, error: String(e) })
  }
})
