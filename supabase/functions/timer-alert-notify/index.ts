// Invoked every minute by the timer-alerts-dispatch pg_cron job (034_timer_alerts.sql).
// Finds due timer_alerts, sends a tailored "Time's up!" push per subscribed device,
// and removes the alert regardless of push outcome — this is a best-effort backup
// to the in-app sound/vibration/pulse alert, not the primary delivery path.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { sendEncryptedPush } from '../_shared/webpush.ts'

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
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { db: { schema: 'companion' } },
  )

  const { data: due, error } = await supabase
    .from('timer_alerts')
    .select('id, user_id, label')
    .lte('fires_at', new Date().toISOString())

  if (error) return new Response(error.message, { status: 500 })
  if (!due?.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 })

  let sent = 0
  for (const alert of due as { id: string; user_id: string; label: string }[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: subs } = await (supabase as any)
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', alert.user_id)

    const results = await Promise.allSettled(
      (subs ?? []).map((s: { endpoint: string; p256dh: string; auth: string }) =>
        sendEncryptedPush(s, {
          title: "⏰ Time's up!",
          body: alert.label,
          tag: 'companion-timer',
          url: '/family/timer',
        }),
      ),
    )
    if (results.some((r) => r.status === 'fulfilled')) sent++

    await supabase.from('timer_alerts').delete().eq('id', alert.id)
  }

  return new Response(JSON.stringify({ processed: due.length, sent }), { status: 200 })
})
