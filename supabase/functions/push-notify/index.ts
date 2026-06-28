import { createClient } from 'jsr:@supabase/supabase-js@2'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC_KEY')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!
const VAPID_CONTACT = 'mailto:admin@myappbuddy.com.au'

function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad), c => c.charCodeAt(0))
}
function b64uEncode(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function makeVapidJWT(audience: string): Promise<string> {
  const pub = b64uDecode(VAPID_PUBLIC)
  const x = b64uEncode(pub.slice(1, 33).buffer as ArrayBuffer)
  const y = b64uEncode(pub.slice(33, 65).buffer as ArrayBuffer)

  const sigKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: VAPID_PRIVATE, x, y, key_ops: ['sign'], ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  )

  const header  = b64uEncode(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = b64uEncode(new TextEncoder().encode(JSON.stringify({
    aud: new URL(audience).origin,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: VAPID_CONTACT,
  })))
  const sigInput = `${header}.${payload}`
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    sigKey,
    new TextEncoder().encode(sigInput)
  )
  return `${sigInput}.${b64uEncode(sig)}`
}

async function sendPush(endpoint: string): Promise<number> {
  const jwt = await makeVapidJWT(endpoint)
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt},k=${VAPID_PUBLIC}`,
      TTL: '86400',
    },
  })
  return res.status
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  let body: {
    record?: { org_id?: string; client_id?: string; sender_id?: string; author_id?: string; user_id?: string }
    type?: string
  }
  try { body = await req.json() } catch { return new Response('bad json', { status: 400 }) }

  const record = body.record
  if (!record?.org_id) return new Response('no org_id', { status: 200 })

  let subs: { endpoint: string }[] | null = null

  if (body.type === 'entry') {
    // Journal entry notification: only family members who opted in for this client
    const authorId = record.author_id ?? record.user_id

    // Find family members linked to this client
    const { data: familyLinks } = await supabase
      .from('client_family')
      .select('family_id')
      .eq('client_id', record.client_id!)
      .eq('status', 'active')

    const familyIds = (familyLinks ?? []).map((l: { family_id: string }) => l.family_id)
    if (!familyIds.length) return new Response('no family', { status: 200 })

    // Filter to those who subscribed with notify_on_entry = true, excluding the author
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (supabase as any)
      .from('push_subscriptions')
      .select('endpoint')
      .in('user_id', familyIds)
      .eq('notify_on_entry', true)

    if (authorId) q.neq('user_id', authorId)

    const { data } = await q
    subs = data
  } else {
    // Message notification: all org members with push subscriptions except the sender
    const senderId = record.sender_id ?? record.user_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = (supabase as any)
      .from('push_subscriptions')
      .select('endpoint')
      .eq('org_id', record.org_id)

    if (senderId) q.neq('user_id', senderId)

    const { data } = await q
    subs = data
  }

  if (!subs?.length) return new Response('no subs', { status: 200 })

  const results = await Promise.allSettled(subs.map((s: { endpoint: string }) => sendPush(s.endpoint)))
  const sent = results.filter(r => r.status === 'fulfilled' && (r.value === 201 || r.value === 200)).length

  return new Response(JSON.stringify({ sent, total: subs.length }), { status: 200 })
})
