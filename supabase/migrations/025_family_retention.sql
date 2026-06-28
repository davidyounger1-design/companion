-- 30-day retention cleanup for free Family plan orgs.
-- Deletes log_entries (and their storage objects) older than 30 days
-- for any org with plan = 'family'.
--
-- Called by the client on session start, but can also be wired to
-- pg_cron if that extension is enabled:
--   SELECT cron.schedule('family-retention', '0 3 * * *',
--     'SELECT delete_expired_family_entries()');

create or replace function public.delete_expired_family_entries()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - interval '30 days';
begin
  -- Delete storage objects for expired entries in family-plan orgs.
  -- Removes the metadata row from storage.objects; Supabase Storage
  -- will handle the underlying file cleanup.
  delete from storage.objects so
  using log_entries le
  join organisations o on o.id = le.org_id
  where so.bucket_id = 'journal-photos'
    and so.name = le.photo_path
    and le.occurred_at < cutoff
    and o.plan = 'family';

  -- Delete the expired entries themselves.
  delete from log_entries le
  using organisations o
  where o.id = le.org_id
    and le.occurred_at < cutoff
    and o.plan = 'family';
end;
$$;

-- Only service role / postgres can call this directly.
revoke all on function public.delete_expired_family_entries() from public, anon, authenticated;
grant execute on function public.delete_expired_family_entries() to service_role;
