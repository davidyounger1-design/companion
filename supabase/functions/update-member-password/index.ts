import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Sets another org member's login password directly — no email round-trip,
// since a coordinator needs this for members who've lost access to their
// inbox or simply forgotten their password. Mirrors update-member-email's
// auth/authorization shape exactly: verify the caller is a coordinator,
// verify the target is in the caller's own org, then use the Admin API
// (the only way to set a password without the member's own session).
//
// Every response — success AND expected/handled failure — uses HTTP 200.
// supabase-js's functions.invoke() only parses the JSON body into `data`
// when the status is 2xx; a non-2xx discards the body and surfaces a
// generic error instead. `ok: false` in the body IS the error signal.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } }, db: { schema: 'companion' } },
    )
    const { data: { user: caller }, error: authErr } = await callerClient.auth.getUser()
    if (authErr || !caller) return json({ ok: false, error: 'not_authenticated' })

    const { data: callerProfile } = await callerClient
      .from('profiles').select('role, org_id').eq('id', caller.id).single()
    if (callerProfile?.role !== 'coordinator' || !callerProfile.org_id) {
      return json({ ok: false, error: 'unauthorized' })
    }

    const { user_id, new_password } = await req.json()
    const password = String(new_password ?? '')
    if (!user_id) return json({ ok: false, error: 'user_id required' })
    if (password.length < 6) return json({ ok: false, error: 'Password must be at least 6 characters' })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { db: { schema: 'companion' } },
    )

    // AUTHORIZATION: target must be a member of the caller's own org — without
    // this, any coordinator could rewrite the password of any account
    // platform-wide just by passing its user_id.
    const { data: targetProfile } = await admin
      .from('profiles').select('org_id').eq('id', user_id).maybeSingle()
    if (!targetProfile || targetProfile.org_id !== callerProfile.org_id) {
      return json({ ok: false, error: 'not_in_your_org' })
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(user_id, { password })
    if (updateErr) return json({ ok: false, error: updateErr.message })

    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: String(e) })
  }
})
