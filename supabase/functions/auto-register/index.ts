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
    const { email, password } = await req.json()
    if (!email || !password) return json({ ok: false, error: 'Missing email or password' }, 400)

    const mabUrl = Deno.env.get('MAB_API_URL') ?? 'https://myappbuddy.com.au'
    const serviceKey = Deno.env.get('COMPANION_SERVICE_KEY') ?? ''

    // Check if this email is an active Companion subscriber in MAB
    const subRes = await fetch(
      `${mabUrl}/api/v1/apps/companion/subscription/check?email=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${serviceKey}` } }
    )

    if (!subRes.ok) return json({ ok: false, error: 'not_subscriber' })

    const subData = await subRes.json()
    const activeStatuses = ['active', 'trialing', 'trial']
    if (!subData?.status || !activeStatuses.includes(subData.status)) {
      return json({ ok: false, error: 'not_subscriber' })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Check if a Supabase auth account already exists for this email
    const { data: { users: existing } } = await admin.auth.admin.listUsers()
    const existingUser = existing?.find(
      (u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase()
    )

    if (existingUser) {
      // Account exists — credentials may be wrong, don't overwrite password
      return json({ ok: false, error: 'account_exists' })
    }

    // Create the Supabase auth account (pre-confirmed — no email verification needed)
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { auto_registered: true },
    })
    if (createErr) return json({ ok: false, error: createErr.message })

    const userId = created.user.id

    // Try to link to an existing org via myappbuddy_account_id
    let orgId: string | null = null
    if (subData.account_id) {
      const { data: org } = await admin
        .from('organisations')
        .select('id')
        .eq('myappbuddy_account_id', subData.account_id)
        .maybeSingle()
      orgId = org?.id ?? null
    }

    // Create profile as coordinator (subscriber is always the account owner)
    await admin.from('profiles').upsert({
      id: userId,
      full_name: subData.name ?? email.split('@')[0],
      role: 'coordinator',
      ...(orgId ? { org_id: orgId } : {}),
    }, { onConflict: 'id' })

    return json({ ok: true, linked_org: !!orgId })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
})
