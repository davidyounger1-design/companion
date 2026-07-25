-- ─────────────────────────────────────────────────────────────
-- 066 · Open active_timers to support workers (idempotent)
--
-- Drops and recreates the active_timers insert/update/delete
-- policies to also allow support workers and trusted support
-- workers to start, replace, and cancel timers for clients they
-- are assigned to. The view policy is unchanged — workers see
-- timers via the existing "can view active timer for own client"
-- policy which already uses client_ids_for_org().
-- ─────────────────────────────────────────────────────────────

drop policy if exists "can start timer for own client"    on companion.active_timers;
drop policy if exists "can replace timer for own client"  on companion.active_timers;
drop policy if exists "can cancel timer for own client"   on companion.active_timers;

create policy "can start timer for own client"
  on companion.active_timers for insert
  with check (
    created_by = auth.uid()
    and org_id = public.my_org_id()
    and (
      client_id in (select public.client_ids_for_recipient())
      or client_id in (select public.client_ids_for_family())
      or (public.my_role() = 'coordinator' and client_id in (select public.client_ids_for_org()))
      or ((public.my_role() in ('support_worker', 'trusted_support_worker'))
          and client_id in (select cw.client_id from companion.client_workers cw where cw.worker_id = auth.uid()))
    )
  );

create policy "can replace timer for own client"
  on companion.active_timers for update
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or ((public.my_role() in ('support_worker', 'trusted_support_worker'))
        and client_id in (select cw.client_id from companion.client_workers cw where cw.worker_id = auth.uid()))
  );

create policy "can cancel timer for own client"
  on companion.active_timers for delete
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or ((public.my_role() in ('support_worker', 'trusted_support_worker'))
        and client_id in (select cw.client_id from companion.client_workers cw where cw.worker_id = auth.uid()))
  );
