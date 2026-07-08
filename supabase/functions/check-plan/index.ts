import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { registerAppRef } from '../_shared/mabLink.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

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
    // The server-side secret that authorises MAB reads. The configured secret
    // is MAB_SECRET_KEY (same one mabLink uses); COMPANION_SERVICE_KEY is kept
    // only as a legacy fallback. Sending an empty key here 401s and yields a
    // null plan, so this must resolve to the real secret.
    const serviceKey = Deno.env.get('MAB_SECRET_KEY')
      || Deno.env.get('COMPANION_SERVICE_KEY') || ''

    const res = await fetch(
      `${mabUrl}/api/v1/apps/companion/subscription/check?email=${encodeURIComponent(user.email)}`,
      { headers: { Authorization: `Bearer ${serviceKey}` } }
    )

    if (!res.ok) {
      return new Response(JSON.stringify({ plan: null, status: null }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const data = await res.json()

    // Keep MAB's app_ref up to date on every login — cheap, idempotent, and
    // self-healing if it's ever missing or stale (see registerAppRef).
    if (data?.subscription_id && ['active', 'trialing'].includes(data?.status)) {
      await registerAppRef(data.subscription_id, user.email)
    }

    return new Response(JSON.stringify(data), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ plan: null, status: null }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
