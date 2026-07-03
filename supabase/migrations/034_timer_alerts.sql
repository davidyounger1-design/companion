-- ─────────────────────────────────────────────────────────────
-- 034 · Background alerts for the visual timer   (idempotent)
--
-- The standalone Timer page (recipient-only) fires a local
-- sound/vibration/pulse alert when the app is open. This table backs
-- a best-effort SECOND alert path for when the app is backgrounded or
-- the phone is locked: a pg_cron job runs every minute, finds due
-- rows, and calls the `timer-alert-notify` edge function to send a
-- real push notification.
--
-- SECURITY — one-time manual step required after running this file:
-- the cron job needs the service_role key to call the edge function,
-- but that key must never be hardcoded into a migration (that
-- mistake was made in 017_push_notify_trigger.sql — flagged
-- separately for cleanup). Instead it's read from Supabase Vault.
-- Run this once in the SQL Editor, pasting your real service_role
-- key (Settings → API → Secret keys):
--
--   select vault.create_secret('<your-service-role-key>', 'service_role_key');
--
-- If a secret with that name already exists, use vault.update_secret
-- instead (see Supabase Vault docs).
-- ─────────────────────────────────────────────────────────────

create table if not exists timer_alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  org_id     uuid not null references organisations(id) on delete cascade,
  label      text not null,
  fires_at   timestamptz not null,
  created_at timestamptz not null default now()
);

alter table timer_alerts enable row level security;

drop policy if exists "own timer alerts" on timer_alerts;

create policy "own timer alerts"
  on timer_alerts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── pg_cron dispatch ──────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('timer-alerts-dispatch')
where exists (select 1 from cron.job where jobname = 'timer-alerts-dispatch');

select cron.schedule(
  'timer-alerts-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://oprsmhyvihrahxpfvdih.supabase.co/functions/v1/timer-alert-notify',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || (
                   select decrypted_secret from vault.decrypted_secrets
                   where name = 'service_role_key'
                 )
               ),
    body    := '{}'::jsonb
  );
  $$
);
