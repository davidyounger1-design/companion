-- ═══════════════════════════════════════════════════════════════════
-- 076 · Server-side entitlements, Part 2 — the actual gate (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-24-privacy-hardening-
-- design.md §3. Depends on `074` (adds `organisations.entitlements` and
-- `public.org_has_feature(text)`) having been run AND every live org's
-- mirror having actually populated — verified directly 2026-08-24, not
-- assumed:
--
--   "The Friendship Circle" (a853f423…, 1 person)  — has all four keys
--   "Sarah Younger's Care Circle"                   — missing
--       behaviour_notes/incident_workflows, but zero rows in either
--       table for this org (checked directly) — nothing for the gate
--       to break
--   "The Friendship Circle" (87f8899c…, 0 people)   — can never log in,
--       so entitlements can never populate; irrelevant either way
--   "fred's Care Circle" (David's own test org)      — entitlements
--       still empty; being deleted, but see pre-flight below regardless
--
-- `behaviour_notes`/`incident_workflows` were earlier assumed ungated
-- client-side — WRONG, corrected 2026-08-24: `has(FEATURES.x)` already
-- hides these sections in ClientManagePanel/CoordinatorDashboard/
-- FamilyDashboard/WorkerClientDetail. This migration only closes the
-- direct-API-call bypass of gating that already exists in the browser
-- — it should surprise nobody who hasn't already been calling the API
-- directly.
-- ═══════════════════════════════════════════════════════════════════

-- ═══ PRE-FLIGHT — run BEFORE this file. Any row here is real recent
--     activity this gate would newly refuse; reconcile before proceeding
--     (either the org's plan is missing a key it should have in MAB
--     Admin, or the activity is from a test org safe to ignore). ═════
select 'behaviour_notes' as table_name, o.name as org_name, count(*) as would_have_been_refused
from   companion.behaviour_notes bn join companion.organisations o on o.id = bn.org_id
where  bn.created_at > now() - interval '30 days' and not (o.entitlements ? 'behaviour_notes')
group  by 1, 2
union all
select 'incidents', o.name, count(*)
from   companion.incidents i join companion.organisations o on o.id = i.org_id
where  i.created_at > now() - interval '30 days' and not (o.entitlements ? 'incident_workflows')
group  by 1, 2
union all
select 'medications', o.name, count(*)
from   companion.medications m join companion.organisations o on o.id = m.org_id
where  m.created_at > now() - interval '30 days' and not (o.entitlements ? 'medication_tracking')
group  by 1, 2
union all
select 'medication_logs', o.name, count(*)
from   companion.medication_logs ml join companion.organisations o on o.id = ml.org_id
where  ml.created_at > now() - interval '30 days' and not (o.entitlements ? 'medication_tracking')
group  by 1, 2
union all
select 'participant_goals', o.name, count(*)
from   companion.participant_goals pg join companion.organisations o on o.id = pg.org_id
where  pg.created_at > now() - interval '30 days' and not (o.entitlements ? 'goals')
group  by 1, 2
order  by 1, 2;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

-- (select …) not a bare call, same reason as 072: the wrapped form is a
-- constant-argument expression the planner folds into an InitPlan
-- evaluated ONCE PER STATEMENT, not once per row. USING and WITH CHECK
-- given explicitly and identically rather than relying on Postgres's
-- implicit USING-as-WITH CHECK fallback for ALL-command policies — the
-- function takes no row-dependent argument, so there is no behavioural
-- difference, only less ambiguity to reconcile later.

drop policy if exists "entitlement gate: behaviour_notes" on companion.behaviour_notes;
create policy "entitlement gate: behaviour_notes"
  on companion.behaviour_notes as restrictive for all to authenticated
  using ((select public.org_has_feature('behaviour_notes')))
  with check ((select public.org_has_feature('behaviour_notes')));

drop policy if exists "entitlement gate: incidents" on companion.incidents;
create policy "entitlement gate: incidents"
  on companion.incidents as restrictive for all to authenticated
  using ((select public.org_has_feature('incident_workflows')))
  with check ((select public.org_has_feature('incident_workflows')));

drop policy if exists "entitlement gate: medications" on companion.medications;
create policy "entitlement gate: medications"
  on companion.medications as restrictive for all to authenticated
  using ((select public.org_has_feature('medication_tracking')))
  with check ((select public.org_has_feature('medication_tracking')));

drop policy if exists "entitlement gate: medication_logs" on companion.medication_logs;
create policy "entitlement gate: medication_logs"
  on companion.medication_logs as restrictive for all to authenticated
  using ((select public.org_has_feature('medication_tracking')))
  with check ((select public.org_has_feature('medication_tracking')));

drop policy if exists "entitlement gate: participant_goals" on companion.participant_goals;
create policy "entitlement gate: participant_goals"
  on companion.participant_goals as restrictive for all to authenticated
  using ((select public.org_has_feature('goals')))
  with check ((select public.org_has_feature('goals')));

commit;


-- ═══ POST-MIGRATION ASSERTIONS · all must return zero rows ═════════

-- A. Every gate policy is RESTRICTIVE, not accidentally permissive
--    (a permissive gate would OR in and widen access instead of narrowing).
select tablename, policyname, permissive
from   pg_policies
where  schemaname = 'companion' and policyname like 'entitlement gate:%'
  and  permissive <> 'RESTRICTIVE';

-- B. Every org_has_feature( call is wrapped in (select …) — per-row
--    evaluation otherwise.
select schemaname, tablename, policyname
from   pg_policies
where  policyname like 'entitlement gate:%'
  and  (coalesce(qual,'') || coalesce(with_check,'')) like '%org_has_feature(%'
  and  (coalesce(qual,'') || coalesce(with_check,''))
       not like '%( SELECT org_has_feature%';

-- C. Exactly one gate policy per target table (catches a partial re-run
--    leaving a stale duplicate under a slightly different name).
select tablename, count(*) from pg_policies
where schemaname = 'companion' and policyname like 'entitlement gate:%'
group by tablename having count(*) <> 1;

-- ── Behavioural, direct API probe (Content-Profile: companion header) ──
-- D. A member of an org whose entitlements lack a gated key gets refused
--    on that table for every command, even one they'd otherwise have a
--    permissive policy for (e.g. a coordinator on "fred's Care Circle").
-- E. A member of an org that DOES have the key sees no change at all —
--    required as much as D; a gate that always denies looks identical
--    to a working one if only the negative case is tested.
