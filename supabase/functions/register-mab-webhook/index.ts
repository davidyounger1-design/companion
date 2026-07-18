import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// One-off (but idempotent — safe to call again after any redeploy) admin
// action: registers Companion's sync-subscription function with MAB's new
// self-service webhook API (POST /v1/apps/:id/webhooks/register, shipped
// 2026-07-17). Before this, MAB had zero webhook endpoints registered for
// app_id='companion' — sync-subscription has been live and healthy this
// whole time but has never received a single real event; entitlement/plan
// sync has relied entirely on the pull-based check-plan call at sign-in.
//
// MAB's full webhook event surface (from GET /api/v1/capabilities) is just
// subscription.created / subscription.canceled / seat.assigned / seat.revoked
// / transaction.recorded / nps.submitted — there is no plan-change/updated
// event, so a plan upgrade/downgrade still only surfaces via the pull-based
// check-plan path (see reconcileOrgPlan + the seat-overage guard in
// AuthContext) even after this webhook is registered. This call only helps
// with subscription create/cancel.
//
// Registering starts the endpoint INACTIVE (fail-closed) — after calling
// this, an admin must still go to MAB Admin -> Developers -> Webhooks and
// click "Activate" once the URL/secret are confirmed correct. The response
// includes a `secret` (whsec_...) — set that as this project's
// MAB_WEBHOOK_SECRET (Supabase Edge Function secret) so sync-subscription's
// HMAC signature check actually verifies real deliveries, since no endpoint
// existed to issue one from before now.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const mabUrl      = Deno.env.get('MAB_API_URL') ?? 'https://myappbuddy.com.au'
    const mabKey      = Deno.env.get('MAB_SECRET_KEY') || Deno.env.get('COMPANION_SERVICE_KEY') || ''

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, db: { schema: 'companion' } })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401)

    const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'companion' } })
    const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single()
    if (caller?.role !== 'coordinator') return json({ ok: false, error: 'Forbidden' }, 403)

    if (!mabKey) return json({ ok: false, error: 'MAB_SECRET_KEY is not configured on this project.' }, 500)

    const webhookUrl = `${supabaseUrl}/functions/v1/sync-subscription`

    const res = await fetch(`${mabUrl}/api/v1/apps/companion/webhooks/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mabKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        events: ['subscription.created', 'subscription.canceled'],
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) return json({ ok: false, error: `register-${res.status}`, detail: data }, 200)

    return json({
      ok: true,
      webhookUrl,
      registered: data,
      nextSteps: [
        `Set MAB_WEBHOOK_SECRET to the "secret" value above (Supabase Edge Function secret for this project).`,
        `In MAB Admin -> Developers -> Webhooks, find this endpoint and click Activate — it starts inactive/fail-closed until approved.`,
      ],
    })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
