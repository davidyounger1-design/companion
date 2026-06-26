import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-mab-signature',
}

function hmacVerify(body: string, signature: string, secret: string): boolean {
  // signature format: sha256=<hex>
  const expected = signature.replace('sha256=', '')
  const encoder = new TextEncoder()
  return crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  ).then(async (key) => {
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
    const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    return hex === expected
  }) as unknown as boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const body = await req.text()
    const signature = req.headers.get('x-mab-signature') ?? ''
    const secret = Deno.env.get('MAB_WEBHOOK_SECRET') ?? ''

    // Verify HMAC signature from MyAppBuddy
    if (secret) {
      const encoder = new TextEncoder()
      const key = await crypto.subtle.importKey(
        'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      )
      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
      const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
      if (`sha256=${hex}` !== signature) {
        return new Response('Invalid signature', { status: 401 })
      }
    }

    const event = JSON.parse(body)
    const { type, subscription } = event

    if (!subscription?.app_id || subscription.app_id !== 'companion') {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Map MyAppBuddy subscription status to Companion billing_status
    const billingStatus: Record<string, string> = {
      active: 'active',
      trialing: 'trial',
      past_due: 'past_due',
      paused: 'past_due',
      canceled: 'cancelled',
    }

    const newStatus = billingStatus[subscription.status] ?? 'trial'
    const planId = subscription.plan_id ?? null

    // Update org by myappbuddy_subscription_id (set when subscription is first created)
    const { error } = await supabase
      .from('organisations')
      .update({
        billing_status: newStatus,
        plan: planId,
        myappbuddy_subscription_id: subscription.id,
        myappbuddy_account_id: subscription.account_id,
      })
      .eq('myappbuddy_subscription_id', subscription.id)

    if (error) {
      console.error('sync-subscription update error:', error)
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, type, status: newStatus }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('sync-subscription error:', e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
