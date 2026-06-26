import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const { token, password, name } = await req.json()
    if (!token || !password || !name) return json({ ok: false, error: 'Missing required fields' }, 400)

    const admin = createClient(supabaseUrl, serviceKey)

    // Validate the invite
    const { data: invite, error: inviteErr } = await admin
      .from('invites')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .maybeSingle()

    if (inviteErr || !invite) return json({ ok: false, error: 'Invalid or already-used invite link.' })

    if (new Date(invite.expires_at) < new Date()) {
      await admin.from('invites').update({ status: 'expired' }).eq('id', invite.id)
      return json({ ok: false, error: 'This invite link has expired.' })
    }

    const email = invite.email as string

    // Check if this email already has an auth account
    const { data: { users: existing } } = await admin.auth.admin.listUsers()
    const existingUser = existing?.find((u) => u.email?.toLowerCase() === email.toLowerCase())

    let userId: string

    if (existingUser) {
      const { error: updateErr } = await admin.auth.admin.updateUserById(existingUser.id, {
        password,
        email_confirm: true,
        user_metadata: { full_name: name.trim() },
      })
      if (updateErr) return json({ ok: false, error: updateErr.message })
      userId = existingUser.id
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name.trim() },
      })
      if (createErr) return json({ ok: false, error: createErr.message })
      userId = created.user.id
    }

    // Upsert profile — ensures the row exists even if the auth trigger hasn't fired yet
    await admin.from('profiles').upsert({
      id: userId,
      full_name: name.trim(),
      org_id: invite.org_id,
      role: invite.role,
    }, { onConflict: 'id' })

    // Link to participant (mirrors what accept_invite RPC does)
    if (invite.client_id) {
      if (invite.role === 'family') {
        await admin.from('client_family').upsert({
          client_id: invite.client_id,
          family_id: userId,
          status: 'active',
        }, { onConflict: 'client_id,family_id' })
      } else if (['support_worker', 'trusted_support_worker'].includes(invite.role)) {
        await admin.from('client_workers').upsert({
          client_id: invite.client_id,
          worker_id: userId,
        }, { onConflict: 'client_id,worker_id' })
      }
    }

    // Mark invite accepted
    await admin.from('invites').update({ status: 'accepted' }).eq('id', invite.id)

    return json({ ok: true, role: invite.role as string })

  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
