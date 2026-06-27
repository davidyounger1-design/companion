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
  // Extract x and y from the uncompressed public key: 0x04 || x(32) || y(32)
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

// Send a signal-only push (no body). The service worker shows a fallback notification.
// Full payload encryption (RFC 8291) can be added later for richer notifications.
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

  let body: { record?: { org_id?: string; sender_id?: string; user_id?: string } }
  try { body = await req.json() } catch { return new Response('bad json', { status: 400 }) }

  const msg = body.record
  if (!msg?.org_id) return new Response('no org_id', { status: 200 })

  const senderId = msg.sender_id ?? msg.user_id
  const query = supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('org_id', msg.org_id)

  if (senderId) query.neq('user_id', senderId)

  const { data: subs } = await query

  if (!subs?.length) return new Response('no subs', { status: 200 })

  const results = await Promise.allSettled(subs.map(s => sendPush(s.endpoint)))
  const sent = results.filter(r => r.status === 'fulfilled' && (r.value === 201 || r.value === 200)).length

  return new Response(JSON.stringify({ sent, total: subs.length }), { status: 200 })
})
