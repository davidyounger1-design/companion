-- ═══════════════════════════════════════════════════════════════════
-- 072 · Bridge ONE key: add_entries -> RESTRICTIVE on log_entries INSERT
--
-- This is deliberately the ONLY permission key bridged to real RLS
-- enforcement in this pass. It is the one key the matrix confirms is a
-- genuine no-op for every role today (add_entries default_allowed
-- matches live policy exactly for coordinator/family/support_worker/
-- recipient; therapist has no INSERT policy on log_entries at all).
--
-- The other 7 catalogue keys (send_messages, edit_own_entry,
-- edit_any_entry, delete_own_entry, add_goals, edit_own_goal,
-- edit_any_goal, delete_own_goal, view_all_entries) stay UNENFORCED
-- (permission_keys.enforced = false) after this migration. Two of them
-- share a command with another key (edit_own/edit_any on UPDATE,
-- likewise the goal pair) which needs a single disjunctive restrictive
-- policy, not two independent ones, or a coordinator/family member who
-- already has broader unconditional deletion/edit rights via the live
-- permissive policies gets silently narrowed too. That needs the same
-- one-key-at-a-time scrutiny this file got, not a freehand pass — see
-- SUBROLE-PERMISSIONS-PLAN.md's remaining-bridge-order list. The
-- PermissionsPage UI must label those toggles "not yet enforced" until
-- each is bridged (see companion code changes).
--
-- ⚠ THIS PROJECT HAD ZERO RESTRICTIVE POLICIES BEFORE THIS FILE. The
--   central enforcement mechanism is being exercised here for the first
--   time, on a live app with a real subscriber and no CI.
--
-- PRE-FLIGHT — run BEFORE this file, must return zero rows:
--   select p.id, p.full_name, p.role, count(*) as would_have_been_refused
--   from companion.log_entries le
--   join companion.profiles p on p.id = le.author_id
--   where le.created_at > now() - interval '30 days'
--     and not coalesce((companion.permissions_for(p.id) ->> 'add_entries')::boolean, false)
--   group by 1,2,3 order by 4 desc;
--
-- The frontend's disabled state for add_entries must already be
-- deployed before this runs — a restrictive policy denies IN-FLIGHT
-- writes: a worker with an open journal composer taps save and the
-- INSERT is refused. In a care-notes app that is clinical-record loss.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- Postgres ANDs restrictive policies against the OR-union of ALL
-- permissive ones, so this covers every current and future permissive
-- INSERT policy on the table at once.
--
-- (select ...) not a bare call: the wrapped form is a constant-argument
-- expression the planner folds into an InitPlan evaluated ONCE PER
-- STATEMENT, not once per row.
drop policy if exists "perm gate: log_entries insert" on companion.log_entries;
create policy "perm gate: log_entries insert"
  on companion.log_entries as restrictive for insert to authenticated
  with check ((select companion.has_perm('add_entries')));

update companion.permission_keys set enforced = true where key = 'add_entries';

commit;

-- ═══ POST-BRIDGE ASSERTIONS · all THREE must return zero rows ══════

-- A. kind vs permissive: a key marked 'gate' whose policy is permissive
--    would widen scope; a 'grant' written restrictive can never admit.
select k.key, k.kind, p.schemaname, p.tablename, p.policyname, p.permissive
from   companion.permission_keys k
join   pg_policies p
  on   coalesce(p.qual,'') || coalesce(p.with_check,'')
       like '%has_perm(''' || k.key || ''')%'
where  (k.kind = 'gate'  and p.permissive <> 'RESTRICTIVE')
   or  (k.kind = 'grant' and p.permissive =  'RESTRICTIVE');

-- B. Every enforced key must appear in at least one policy.
select k.key from companion.permission_keys k
where  k.enforced
  and  not exists (
    select 1 from pg_policies p
    where coalesce(p.qual,'') || coalesce(p.with_check,'')
          like '%has_perm(''' || k.key || ''')%');

-- C. Any has_perm( call not wrapped in (select …) — per-row evaluation.
select schemaname, tablename, policyname
from   pg_policies
where  (coalesce(qual,'') || coalesce(with_check,'')) like '%has_perm(%'
  and  (coalesce(qual,'') || coalesce(with_check,''))
       not like '%( SELECT companion.has_perm%';
