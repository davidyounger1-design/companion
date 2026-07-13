import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Changes another org member's login email. Email lives on auth.users, not
// profiles — profiles has no email column at all (get_org_members joins
// auth.users for it) — so this can only be done with the service role via
// the Admin API, never through a plain RLS-scoped update. Mirrors
// delete-member's auth/authorization shape: verify the caller is a
// coordinator, then verify the target is in the caller's own org before
// touching anything.
//
// IMPORTANT: every response — success AND expected/handled failure — uses
// HTTP 200. supabase-js's functions.invoke() only parses the JSON body into
// `data` when the status is 2xx; on a non-2xx it discards the body entirely
// and surfaces a generic "Edge Function returned a non-2xx status code"
// instead, which is exactly what silently swallowed every `error` message
// this function ever returned. `ok: false` in the body IS the error signal
// here — reserve HTTP status for transport-level failures the client
// wouldn't otherwise handle.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  try {
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )
    const { data: { user: caller }, error: authErr } = await callerClient.auth.getUser()
    if (authErr || !caller) return json({ ok: false, error: 'not_authenticated' })

    const { data: callerProfile } = await callerClient
      .from('profiles').select('role, org_id').eq('id', caller.id).single()
    if (callerProfile?.role !== 'coordinator' || !callerProfile.org_id) {
      return json({ ok: false, error: 'unauthorized' })
    }

    const { user_id, new_email } = await req.json()
    const email = String(new_email ?? '').trim().toLowerCase()
    if (!user_id) return json({ ok: false, error: 'user_id required' })
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'Enter a valid email address' })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // AUTHORIZATION: target must be a member of the caller's own org — without
    // this, any coordinator could rewrite the login email of any account
    // platform-wide just by passing its user_id.
    const { data: targetProfile } = await admin
      .from('profiles').select('org_id').eq('id', user_id).maybeSingle()
    if (!targetProfile || targetProfile.org_id !== callerProfile.org_id) {
      return json({ ok: false, error: 'not_in_your_org' })
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(user_id, {
      email,
      email_confirm: true, // coordinator-initiated — takes effect immediately, no confirmation email
    })
    if (updateErr) {
      const msg = /already been registered|already exists/i.test(updateErr.message)
        ? 'That email is already in use by another account'
        : updateErr.message
      return json({ ok: false, error: msg })
    }

    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: String(e) })
  }
})
