-- 090_restrict_register_deletes.sql — NDIS registers are non-destructible
--
-- The coordinator policies on the two NDIS register tables (086's
-- restrictive_practices, 087's behaviour_support_plans) were created as
-- `for all`, which permits hard DELETE. These are the tables most in need of
-- non-destructibility: a deleted register row is unrecoverable and never
-- audited — 084's fn_record_revision() trigger snapshots OLD rows on
-- BEFORE UPDATE only, so a DELETE leaves no trace anywhere.
--
-- PostgreSQL's CREATE POLICY FOR clause accepts a single command (there is
-- no comma-separated list), so the coordinator "manage" policy is rewritten
-- as three per-command policies — select, insert, update — each carrying the
-- original predicate. DELETE gets no policy at all: once RLS is enabled, a
-- command no policy covers is denied to everyone except the table owner.
--
-- Predicates preserved exactly as in 086/087; drops make this idempotent for
-- re-runs. Schema-qualified throughout (per 060+ convention). The workers'
-- and decision_maker's view-only policies are untouched — they were `for
-- select` already and never had DELETE.

drop policy if exists "coordinators can manage restrictive practices"     on companion.restrictive_practices;
drop policy if exists "coordinators can view restrictive practices"       on companion.restrictive_practices;
drop policy if exists "coordinators can insert restrictive practices"     on companion.restrictive_practices;
drop policy if exists "coordinators can update restrictive practices"     on companion.restrictive_practices;

create policy "coordinators can view restrictive practices"
  on companion.restrictive_practices for select
  using (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );
create policy "coordinators can insert restrictive practices"
  on companion.restrictive_practices for insert
  with check (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );
create policy "coordinators can update restrictive practices"
  on companion.restrictive_practices for update
  using (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );

drop policy if exists "coordinators can manage behaviour support plans"   on companion.behaviour_support_plans;
drop policy if exists "coordinators can view behaviour support plans"     on companion.behaviour_support_plans;
drop policy if exists "coordinators can insert behaviour support plans"   on companion.behaviour_support_plans;
drop policy if exists "coordinators can update behaviour support plans"   on companion.behaviour_support_plans;

create policy "coordinators can view behaviour support plans"
  on companion.behaviour_support_plans for select
  using (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );
create policy "coordinators can insert behaviour support plans"
  on companion.behaviour_support_plans for insert
  with check (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );
create policy "coordinators can update behaviour support plans"
  on companion.behaviour_support_plans for update
  using (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );
