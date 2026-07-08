import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Returns MyAppBuddy's app-scoped PUBLISHABLE key (pk_…) for the embed widgets.
// The publishable key is safe client-side, but MAB mints it from the SECRET key,
// which must stay server-side — so we fetch it here and hand only the pk down.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    // Require a signed-in caller (the screen is coordinator-only anyway).
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ publishableKey: null })
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ publishableKey: null })

    const mabUrl = Deno.env.get('MAB_API_URL') ?? 'https://myappbuddy.com.au'
    const key = Deno.env.get('MAB_SECRET_KEY') || Deno.env.get('COMPANION_SERVICE_KEY') || ''

    const res = await fetch(`${mabUrl}/api/v1/link/publishable-key`, {
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) return json({ publishableKey: null })
    const data = await res.json().catch(() => ({}))
    const pk: string | null =
      data?.publishableKey ?? data?.publishable_key ?? data?.key ?? data?.pk ?? null
    return json({ publishableKey: pk })
  } catch {
    return json({ publishableKey: null })
  }
})
