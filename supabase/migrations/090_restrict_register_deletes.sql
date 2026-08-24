-- 090_restrict_register_deletes.sql — NDIS registers are non-destructible
--
-- The coordinator policies on the two NDIS register tables (086's
-- restrictive_practices, 087's behaviour_support_plans) were created as
-- `for all`, which permits hard DELETE. These are the tables most in need of
-- non-destructibility: a deleted register row is unrecoverable and never
-- audited — 084's fn_record_revision() trigger snapshots OLD rows on
-- BEFORE UPDATE only, so a DELETE leaves no trace anywhere.
--
-- Rewrite both coordinator policies as `for select, insert, update` (no
-- delete). Using expressions preserved exactly as in 086/087; drops make this
-- idempotent for re-runs. Schema-qualified throughout (per 060+ convention).
-- Workers' view-only and decision_maker's view-only policies are untouched —
-- they never had DELETE anyway.

drop policy if exists "coordinators can manage restrictive practices" on companion.restrictive_practices;
create policy "coordinators can manage restrictive practices"
  on companion.restrictive_practices for select, insert, update
  using (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );

drop policy if exists "coordinators can manage behaviour support plans" on companion.behaviour_support_plans;
create policy "coordinators can manage behaviour support plans"
  on companion.behaviour_support_plans for select, insert, update
  using (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );
