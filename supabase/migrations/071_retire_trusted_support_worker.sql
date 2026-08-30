-- ═══════════════════════════════════════════════════════════════════
-- 071 · Retire trusted_support_worker.
--
--       DO NOT RUN until the app + edge functions are deployed AND you
--       have personally confirmed the served build no longer offers the
--       role. The gate below is a HUMAN ATTESTATION, not an inference —
--       "the frontend shipped" does not mean "clients are running it"
--       (an installed PWA can run the old bundle until the user taps
--       refresh).
--
--       To open the gate, after checking the live build:
--         insert into companion.migration_gates (gate, note)
--         values ('frontend_retirement_verified', '<build/version + date>');
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0 · GATE ───────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from companion.migration_gates
                 where gate = 'frontend_retirement_verified') then
    raise exception
      'Gate closed. Verify the served frontend no longer offers trusted_support_worker, then insert the frontend_retirement_verified gate row.';
  end if;
end $$;

-- ── 1 · CATCH-UP backfill, in this transaction ─────────────────────
insert into companion.sub_roles (org_id, base_role, name, is_default)
select distinct p.org_id, 'trusted_support_worker', 'Trusted worker (migrating)', false
from   companion.profiles p
where  p.role = 'trusted_support_worker' and p.org_id is not null
  and  not exists (select 1 from companion.sub_roles s
                    where s.org_id = p.org_id and s.base_role = 'trusted_support_worker');

update companion.profiles p set sub_role_id = s.id
from companion.sub_roles s
where s.org_id = p.org_id and s.base_role = 'trusted_support_worker'
  and p.role = 'trusted_support_worker' and p.sub_role_id is null;

-- ── 2 · THE FLIP. role and sub_role_id move in ONE statement ───────
update companion.profiles p
   set role = 'support_worker',
       sub_role_id = coalesce(
         (select tw.id from companion.sub_roles tw
           where tw.org_id = p.org_id and tw.base_role = 'support_worker'
             and lower(btrim(tw.name)) = 'trusted worker' and tw.archived_at is null),
         (select dflt.id from companion.sub_roles dflt
           where dflt.org_id = p.org_id and dflt.base_role = 'support_worker'
             and dflt.is_default and dflt.archived_at is null))
where p.role = 'trusted_support_worker';

update companion.invites i
   set role = 'support_worker',
       sub_role_id = coalesce(
         (select tw.id from companion.sub_roles tw
           where tw.org_id = i.org_id and tw.base_role = 'support_worker'
             and lower(btrim(tw.name)) = 'trusted worker' and tw.archived_at is null),
         (select dflt.id from companion.sub_roles dflt
           where dflt.org_id = i.org_id and dflt.base_role = 'support_worker'
             and dflt.is_default and dflt.archived_at is null))
where i.role = 'trusted_support_worker';

-- ── 3 · ASSERT before tightening ───────────────────────────────────
do $$
declare n_p bigint; n_i bigint; n_null bigint;
begin
  select count(*) into n_p from companion.profiles where role = 'trusted_support_worker';
  select count(*) into n_i from companion.invites  where role = 'trusted_support_worker';
  select count(*) into n_null from companion.profiles
    where role = 'support_worker' and org_id is not null and sub_role_id is null;
  if n_p > 0 or n_i > 0 then
    raise exception 'Flip incomplete: % profile(s), % invite(s) still hold the retired role', n_p, n_i;
  end if;
  if n_null > 0 then
    raise exception '% support_worker profile(s) have no sub-role — check ensure_default_sub_roles ran', n_null;
  end if;
end $$;

-- ── 4 · Tighten BOTH check constraints ─────────────────────────────
alter table companion.profiles drop constraint if exists profiles_role_check;
alter table companion.profiles
  add constraint profiles_role_check
  check (role in ('coordinator','support_worker','family','therapist','recipient'));

alter table companion.invites drop constraint if exists invites_role_check;
alter table companion.invites
  add constraint invites_role_check
  check (role in ('coordinator','support_worker','family','therapist','recipient'));

-- ── 5 · Drop the trusted-only policies ─────────────────────────────
drop policy if exists "trusted workers can create support worker invites" on companion.invites;
drop policy if exists "trusted workers can view support worker invites"   on companion.invites;
-- Redundant even before retirement: "workers can log for assigned
-- clients" has NO role test and the identical client_ids_for_worker()
-- predicate, so a plain support_worker already holds this INSERT right.
drop policy if exists "trusted workers can log for assigned clients" on companion.log_entries;

-- ── 6 · can_view_log_entry: narrow the IN-list (verified via I9) ───
-- This one function's live body WAS captured by the I9 dump, so it is
-- safe to narrow here. Every other policy referencing
-- ('support_worker','trusted_support_worker') IN-lists (log_entries
-- SELECT, storage.objects SELECT, client_feedback INSERT, the three
-- active_timers policies, the messages SELECT policy) is deliberately
-- LEFT ALONE — their exact live predicates were never captured by any
-- inspect query in this plan, and narrowing them from a guess risks a
-- real regression on the one org that matters for zero behavioural
-- gain (an IN-list containing a value no row can ever hold again is
-- harmless, just slightly stale-looking). Revisit as a separate,
-- properly-inspected cleanup pass if it's worth doing at all.
create or replace function public.can_view_log_entry(p_entry_id uuid)
returns boolean language sql stable security definer
set search_path = 'companion', 'public' as $$
  select exists (
    select 1 from companion.log_entries le
    where le.id = p_entry_id
      and ( (public.my_role() = 'support_worker' and le.author_id = auth.uid())
         or (le.org_id = public.my_org_id() and public.my_role() = 'coordinator')
         or (le.client_id in (select public.client_ids_for_family()))
         or (le.client_id in (select public.client_ids_for_recipient())) )
  )
$$;

-- ── 7 · Rename the migrating twins, archive them ───────────────────
update companion.sub_roles
   set archived_at = coalesce(archived_at, now())
 where base_role = 'trusted_support_worker';

commit;

-- ── POST-071 · re-run the 070 verification query. Byte-identical
--    resolved_perms for Sarah Younger's Care Circle, and every role now
--    'support_worker'. That equality IS the proof of parity.
