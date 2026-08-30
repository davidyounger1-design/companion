-- 085_retention_cron.sql — nightly dispatch for entitlement-based retention
--
-- Server-side enforcement for the `retention_<n>` MAB entitlement
-- (GAP-REPORT-HANDOFF §3): retention has been client-side only, so an org
-- that lost a retention entitlement kept data the hub said should be purged.
-- The `retention-purge` edge function reads `companion.organisations.entitlements`
-- directly (no MAB round-trip, no client involvement) and purges log_entries
-- older than the shortest `retention_<n>` window found — no retention key
-- means keep forever (052's documented fail-safe). This job dispatches that
-- function nightly, mirroring 034's timer-alerts cron pattern (service_role
-- key held in Vault, never a literal).
--
-- Apply this migration before or after deploying the `retention-purge` edge
-- function; both are safe independently (the function returns 200 with
-- { ok: false } on failure, and a 404 from the cron target is logged by
-- pg_cron rather than retried into a loop).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('retention-purge-dispatch')
where exists (select 1 from cron.job where jobname = 'retention-purge-dispatch');

select cron.schedule(
  'retention-purge-dispatch',
  '17 3 * * *',
  $$
  select net.http_post(
    url     := 'https://oprsmhyvihrahxpfvdih.supabase.co/functions/v1/retention-purge',
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
