import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Inlined from _shared/mabLink.ts so this function deploys as a single file
// (the dashboard editor doesn't bundle ../_shared). Keeps MAB's app_ref pointed
// at the signed-in user so the embedded support/ideas widgets work.
async function registerAppRef(subscriptionId: string, email: string): Promise<boolean> {
  const secretKey = Deno.env.get('MAB_SECRET_KEY') || Deno.env.get('COMPANION_SERVICE_KEY')
  if (!secretKey || !subscriptionId || !email) return false
  try {
    const res = await fetch(
      `https://myappbuddy.com.au/api/v1/link/subscriptions/${encodeURIComponent(subscriptionId)}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: email }),
      },
    )
    return res.ok
  } catch {
    return false
  }
}

interface LinkSub {
  id?: string
  status?: string
  planName?: string
  planId?: string
  plan_id?: string
  ownerEmail?: string
  accountId?: string
  seats?: number
  createdAt?: string
}

interface PlanCatalogEntry {
  id?: string
  name?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const nullPlan = { plan: null, plan_id: null, status: null, subscription_id: null, account_id: null, seats: null }
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response('Unauthorized', { status: 401, headers: cors })

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user?.email) return new Response('Unauthorized', { status: 401, headers: cors })

    const mabUrl = Deno.env.get('MAB_API_URL') ?? 'https://myappbuddy.com.au'
    const serviceKey = Deno.env.get('MAB_SECRET_KEY')
      || Deno.env.get('COMPANION_SERVICE_KEY') || ''

    const res = await fetch(
      `${mabUrl}/api/v1/link/subscriptions?app=companion&status=all`,
      { headers: { Authorization: `Bearer ${serviceKey}` } },
    )
    if (!res.ok) return json(nullPlan)

    const data = await res.json()
    const subs: LinkSub[] = Array.isArray(data) ? data : (data?.subscriptions ?? [])
    const email = user.email.toLowerCase()

    // Resolution order (v18):
    // 1. The caller's org stores its MAB subscription id (myappbuddy_subscription_id)
    //    — the authoritative match for every member of the org, not just the
    //    subscription owner. Read it with the service role; treat any failure
    //    here as "no preference", never as a hard error.
    // 2. Fallback (unchanged v17 behaviour): owner-email match from /link —
    //    among the caller's subscriptions prefer active ones, then the most
    //    recently created (their current plan).
    let chosen: LinkSub | undefined
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    if (serviceRoleKey) {
      try {
        const admin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          serviceRoleKey,
          { db: { schema: 'companion' }, auth: { persistSession: false } },
        )
        const { data: prof, error: profErr } = await admin
          .from('profiles').select('org_id').eq('id', user.id).maybeSingle()
        if (!profErr && prof?.org_id) {
          const { data: orgRow } = await admin
            .from('organisations').select('myappbuddy_subscription_id')
            .eq('id', prof.org_id).maybeSingle()
          const orgSubId = orgRow?.myappbuddy_subscription_id ?? null
          if (orgSubId) chosen = subs.find((s) => s.id === orgSubId)
        }
      } catch {
        // Org lookup is a preference — fall through to the email match below.
      }
    }

    if (!chosen) {
      const mine = subs.filter((s) => s.ownerEmail?.toLowerCase() === email)
      const active = mine.filter((s) => ['active', 'trialing', 'trial'].includes(s.status ?? ''))
      const pool = active.length ? active : mine
      pool.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
      chosen = pool[0]
    }
    if (!chosen?.id) return json(nullPlan)

    const result = {
      plan: chosen.planName ?? null,
      plan_id: chosen.planId ?? chosen.plan_id ?? null,
      status: chosen.status ?? null,
      subscription_id: chosen.id ?? null,
      account_id: chosen.accountId ?? null,
      seats: typeof chosen.seats === 'number' ? chosen.seats : null,
    }

    // /link carries the plan id but sometimes not the display name — resolve it
    // from MAB's public plans catalog so the app never shows a raw plan id.
    if (!result.plan && result.plan_id) {
      try {
        const catRes = await fetch(`${mabUrl}/api/v1/plans`)
        if (catRes.ok) {
          const cat = await catRes.json()
          const plans: PlanCatalogEntry[] = Array.isArray(cat?.plans) ? cat.plans : []
          result.plan = plans.find((p) => p.id === result.plan_id)?.name ?? null
        }
      } catch {
        // Leave plan null — the client prettifies the id as a last resort.
      }
    }

    // Keep MAB's app_ref current on login — cheap, idempotent, self-healing.
    if (result.subscription_id && ['active', 'trialing', 'trial'].includes(result.status ?? '')) {
      await registerAppRef(result.subscription_id, user.email)
    }

    return json(result)
  } catch {
    return json(nullPlan)
  }
})
