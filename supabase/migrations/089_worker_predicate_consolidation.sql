-- 089_worker_predicate_consolidation.sql — one canonical worker-access predicate
--
-- Programs prep (plan Task 6, GAP-REPORT-HANDOFF §4): 053/058/066 still inline
-- `client_workers where worker_id = auth.uid()` into eleven RLS policies, which
-- predates 069's canonical helper and — critically — lacks 069's cross-tenant
-- org test (`clients.org_id = my_org_id()`), so a worker profile with client
-- assignments in a second organisation could read across the tenant boundary.
--
-- This migration rewrites every live worker-membership predicate to
-- `(select public.client_ids_for_worker())` — the same expression 086/087
-- already use — so every worker-scoped policy in the schema answers to one
-- SECURITY DEFINER helper with the org test built in. 054's three worker
-- policies are NOT rewritten: 058 dropped them (058:21-23) and they are dead.
--
-- Mechanical only: policy names, grant scopes, role branches, and every
-- non-worker clause (coordinator/family/recipient/decision_maker) are
-- preserved verbatim. The retired `trusted_support_worker` role in 066's
-- branches is left as-is — role retirement is 071's concern, not this rewrite.

-- ── incidents (053) ───────────────────────────────────────────────

drop policy if exists "workers can create incidents" on companion.incidents;
drop policy if exists "workers can view incidents"   on companion.incidents;

create policy "workers can create incidents"
  on companion.incidents for insert
  with check (
    author_id = auth.uid() and
    client_id in (select public.client_ids_for_worker())
  );

create policy "workers can view incidents"
  on companion.incidents for select
  using (
    client_id in (select public.client_ids_for_worker())
  );

-- ── participant_goals (058) ───────────────────────────────────────

drop policy if exists "connected users can view goals"            on companion.participant_goals;
drop policy if exists "connected users can add goals"             on companion.participant_goals;
drop policy if exists "workers can edit their own goals"          on companion.participant_goals;
drop policy if exists "workers can delete their own goals"        on companion.participant_goals;

create policy "connected users can view goals"
  on companion.participant_goals for select
  using (
    (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or client_id in (select client_id from companion.client_family where family_id = auth.uid() and status = 'active')
    or client_id in (select id from companion.clients where recipient_profile_id = auth.uid())
    or client_id in (select public.client_ids_for_worker())
    or client_id in (select id from companion.clients where decision_maker_id = auth.uid())
  );

create policy "connected users can add goals"
  on companion.participant_goals for insert
  with check (
    created_by = auth.uid()
    and (
      (org_id = public.my_org_id() and public.my_role() = 'coordinator')
      or client_id in (select client_id from companion.client_family where family_id = auth.uid() and status = 'active')
      or client_id in (select id from companion.clients where recipient_profile_id = auth.uid())
      or client_id in (select public.client_ids_for_worker())
    )
  );

create policy "workers can edit their own goals"
  on companion.participant_goals for update
  using (
    created_by = auth.uid()
    and client_id in (select public.client_ids_for_worker())
  );

create policy "workers can delete their own goals"
  on companion.participant_goals for delete
  using (
    created_by = auth.uid()
    and client_id in (select public.client_ids_for_worker())
  );

-- ── goal_progress_records (058) ───────────────────────────────────

drop policy if exists "connected users can view progress" on companion.goal_progress_records;
drop policy if exists "connected users can log progress"  on companion.goal_progress_records;

create policy "connected users can view progress"
  on companion.goal_progress_records for select
  using (
    (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or client_id in (select client_id from companion.client_family where family_id = auth.uid() and status = 'active')
    or client_id in (select id from companion.clients where recipient_profile_id = auth.uid())
    or client_id in (select public.client_ids_for_worker())
    or client_id in (select id from companion.clients where decision_maker_id = auth.uid())
  );

create policy "connected users can log progress"
  on companion.goal_progress_records for insert
  with check (
    author_id = auth.uid()
    and (
      (org_id = public.my_org_id() and public.my_role() = 'coordinator')
      or client_id in (select client_id from companion.client_family where family_id = auth.uid() and status = 'active')
      or client_id in (select id from companion.clients where recipient_profile_id = auth.uid())
      or client_id in (select public.client_ids_for_worker())
    )
  );

-- ── active_timers (066) ───────────────────────────────────────────

drop policy if exists "can start timer for own client"   on companion.active_timers;
drop policy if exists "can replace timer for own client" on companion.active_timers;
drop policy if exists "can cancel timer for own client"  on companion.active_timers;

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
          and client_id in (select public.client_ids_for_worker()))
    )
  );

create policy "can replace timer for own client"
  on companion.active_timers for update
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or ((public.my_role() in ('support_worker', 'trusted_support_worker'))
        and client_id in (select public.client_ids_for_worker()))
  );

create policy "can cancel timer for own client"
  on companion.active_timers for delete
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or ((public.my_role() in ('support_worker', 'trusted_support_worker'))
        and client_id in (select public.client_ids_for_worker()))
  );
