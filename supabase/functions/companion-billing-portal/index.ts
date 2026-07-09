import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface LinkSub {
  id?: string
  status?: string
  ownerEmail?: string
  createdAt?: string
}

// Mints a one-time magic-login URL into the caller's MyAppBuddy billing portal,
// where they can upgrade/downgrade/cancel and view invoices/payment methods —
// MAB owns all the billing-sensitive logic, we just open the door.
//
// Subscription id is resolved LIVE from MAB by matching the caller's email
// against /api/v1/link/subscriptions (same approach as check-plan), not from
// organisations.myappbuddy_subscription_id — that column is only ever written
// once at initial checkout and goes stale the moment a subscription changes
// in MAB (e.g. an upgrade issues a new id), which silently broke this exact
// button. Resolving live avoids depending on that mirror at all.
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
    if (!user?.email) return json({ url: null, error: 'unauthorized' }, 401)

    const mabUrl = Deno.env.get('MAB_API_URL') ?? 'https://myappbuddy.com.au'
    const key = Deno.env.get('MAB_SECRET_KEY') || Deno.env.get('COMPANION_SERVICE_KEY') || ''

    const listRes = await fetch(
      `${mabUrl}/api/v1/link/subscriptions?app=companion&status=all`,
      { headers: { Authorization: `Bearer ${key}` } },
    )
    if (!listRes.ok) return json({ url: null, error: `lookup-${listRes.status}` })

    const listData = await listRes.json().catch(() => ({}))
    const subs: LinkSub[] = Array.isArray(listData) ? listData : (listData?.subscriptions ?? [])
    const email = user.email.toLowerCase()
    const mine = subs.filter((s) => s.ownerEmail?.toLowerCase() === email)
    const active = mine.filter((s) => ['active', 'trialing', 'trial'].includes(s.status ?? ''))
    const pool = active.length ? active : mine
    pool.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    const subId = pool[0]?.id
    if (!subId) return json({ url: null, error: 'no-subscription' })

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
