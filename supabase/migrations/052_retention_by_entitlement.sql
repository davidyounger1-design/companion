-- ─────────────────────────────────────────────────────────────
-- 052 · Retention is now an entitlement, not plan='family'
--
-- Retention used to be hard-wired to plan='family' (migration 025):
-- delete journal entries older than 30 days for every family org. But
-- retention is now a MAB entitlement (`retention_<n>`), decoupled from
-- the family plan — a paid family plan (companion_family, no retention
-- entitlement) must keep entries FOREVER, yet still carries the local
-- plan='family' sentinel. The old server purge would wrongly delete
-- their data.
--
-- Entitlements live in MAB and are resolved client-side (check-features
-- / useFeatures), so the app enforces retention on session start with a
-- fail-safe rule: only purge when a positive retention window is known.
-- This server function can't read MAB entitlements, so it must NOT
-- delete on the plan='family' assumption. Neutralise it to a no-op
-- (kept, not dropped, in case a pg_cron job still references it).
-- ─────────────────────────────────────────────────────────────

create or replace function public.delete_expired_family_entries()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Intentionally does nothing. Retention is enforced in-app from the
  -- `retention_<n>` entitlement (fail-safe: keep forever when unknown).
  -- Deleting here by plan='family' would purge paid family plans that are
  -- meant to retain entries indefinitely.
  return;
end;
$$;

revoke all on function public.delete_expired_family_entries() from public, anon, authenticated;
grant execute on function public.delete_expired_family_entries() to service_role;

-- If a pg_cron schedule was ever created for this, remove it so the no-op
-- isn't run pointlessly (safe if it doesn't exist).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from cron.job where jobname = 'family-retention') then
    perform cron.unschedule('family-retention');
  end if;
exception when others then
  null; -- cron schema not present / no permission — nothing to clean up
end $$;
