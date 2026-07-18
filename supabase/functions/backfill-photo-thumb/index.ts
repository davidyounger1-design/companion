import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// One-off maintenance helper for the photo-thumbnail backfill (coordinator
// Settings → Photo thumbnails). The heavy lifting (download, decrypt,
// downscale, re-encrypt, re-upload) happens client-side, where Web Crypto
// and Canvas actually live — this function only does the final privileged
// write. It exists because log_entries' only UPDATE policy is
// "authors can update own log entries" (author_id = auth.uid()): a
// coordinator backfilling thumbnails for an entire org needs to touch rows
// authored by other people (family members, workers), which their own
// session can't do. Runs as service-role and re-checks org membership
// itself, since that's the only thing standing between a coordinator and
// writing to another org's row.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'Unauthorized' })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      db: { schema: 'companion' },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ ok: false, error: 'Unauthorized' })

    const { entry_id, thumb_path } = await req.json()
    if (!entry_id || !thumb_path) return json({ ok: false, error: 'Missing required fields' })

    const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'companion' } })

    const { data: caller } = await admin.from('profiles').select('role, org_id').eq('id', user.id).single()
    if (caller?.role !== 'coordinator') return json({ ok: false, error: 'Forbidden' })

    const { data: entry } = await admin.from('log_entries').select('org_id').eq('id', entry_id).maybeSingle()
    if (!entry || entry.org_id !== caller.org_id) return json({ ok: false, error: 'Forbidden' })

    const { error } = await admin.from('log_entries').update({ photo_thumb_path: thumb_path }).eq('id', entry_id)
    if (error) return json({ ok: false, error: error.message })

    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message })
  }
})
