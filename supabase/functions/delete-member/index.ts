import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// IMPORTANT: every response — success AND expected/handled failure — uses
// HTTP 200. supabase-js's functions.invoke() only parses the JSON body into
// `data` when the status is 2xx; on a non-2xx it discards the body and
// surfaces a generic "Edge Function returned a non-2xx status code"
// instead, silently swallowing whichever `error` string was actually
// returned (which is why MembersPage's REMOVE_ERRORS mapping never worked).
// `ok: false` in the body IS the error signal — reserve HTTP status for
// transport-level failures the client wouldn't otherwise handle.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // Verify caller is coordinator
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )
    const { data: { user: caller }, error: authErr } = await callerClient.auth.getUser()
    if (authErr || !caller) {
      return new Response(JSON.stringify({ ok: false, error: 'not_authenticated' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: callerProfile } = await callerClient
      .from('profiles').select('role, org_id').eq('id', caller.id).single()
    if (callerProfile?.role !== 'coordinator' || !callerProfile.org_id) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { user_id } = await req.json()
    if (!user_id) {
      return new Response(JSON.stringify({ ok: false, error: 'user_id required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // AUTHORIZATION: the target must be a member of the caller's own org.
    // Without this check, any coordinator (every signup is one by default)
    // could delete ANY account platform-wide just by passing its user_id.
    // This runs before remove_member nils org_id, so it must be the sole
    // deletion path (the frontend no longer pre-detaches via remove_member).
    const { data: targetProfile } = await admin
      .from('profiles').select('org_id, role').eq('id', user_id).maybeSingle()
    if (!targetProfile || targetProfile.org_id !== callerProfile.org_id) {
      return new Response(JSON.stringify({ ok: false, error: 'not_in_your_org' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Don't let the org be orphaned: block removing the last coordinator.
    if (targetProfile.role === 'coordinator') {
      const { count } = await admin
        .from('profiles').select('id', { count: 'exact', head: true })
        .eq('org_id', callerProfile.org_id).eq('role', 'coordinator')
      if ((count ?? 0) <= 1) {
        return new Response(JSON.stringify({ ok: false, error: 'last_coordinator' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Purge the target's pending invites in this org.
    const { data: { user: targetUser } } = await admin.auth.admin.getUserById(user_id)
    if (targetUser?.email) {
      await admin.from('invites')
        .delete()
        .eq('email', targetUser.email)
        .eq('org_id', callerProfile.org_id)
        .in('status', ['pending', 'expired'])
    }

    // Delete the auth user. profiles.id → auth.users ON DELETE CASCADE, and
    // client_workers/client_family/client_circle → profiles ON DELETE CASCADE,
    // so this removes the profile and all org linkages in one shot.
    const { error: deleteErr } = await admin.auth.admin.deleteUser(user_id)
    if (deleteErr) {
      return new Response(JSON.stringify({ ok: false, error: deleteErr.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
