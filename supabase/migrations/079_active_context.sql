-- ═══════════════════════════════════════════════════════════════════
-- 079 · Identity & access model, Step 3 — active-context plumbing
--       (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-24-identity-access-
-- model-design.md §2.3, §3.3, §5 step 3, and residual risk #3 ("my_org_
-- id()/my_role() are being made context-dependent while remaining
-- scalar ... a trapdoor"). Read that before touching anything here.
--
-- THE BLAST RADIUS, checked live 2026-08-24: 103 RLS policies and 10
-- other functions call my_org_id()/my_role() directly. This migration
-- changes what those two functions RESOLVE AGAINST, not their
-- signature — every one of those 113 call sites is untouched and needs
-- no edit, which is the entire reason the spec insisted on this shape
-- rather than reworking how access is resolved everywhere.
--
-- THE CONTRACT: the active org travels as the request header
-- `x-active-org-id` (a plain org uuid). No frontend sends this yet —
-- that is step 4, not built here. Until it exists, every profile today
-- has exactly one profile_orgs membership and sends no header, so this
-- step is INVISIBLE by construction: my_org_id()/my_role() resolve to
-- exactly what they resolve to today, for every current user.
--
-- FAIL-CLOSED RULES (never violate these when touching this again):
--   - Header present, names a plan I belong to  -> that plan. Only that
--     plan — never also considered against a single-membership default.
--   - Header present, names a plan I do NOT belong to -> NULL. Never
--     falls back to my one membership; that would let a stale or
--     forged header on a two-plan account silently widen to whichever
--     plan happens to be the "default" — this is the literal
--     enforcement of §2.3's "resolves to no access, never to a default."
--   - Header absent (or unparseable — treated the same as absent, see
--     below) and I have exactly one active membership -> that membership.
--   - Header absent and I have zero or 2+ active memberships -> NULL.
--     Ambiguity is not a coin flip.
-- NULL then propagates through every existing `= my_org_id()` /
-- `= public.my_role()` comparison as "matches nothing" — none of the
-- 113 call sites need to know any of this happened.
--
-- Why pure SQL, not plpgsql with exception handling, for the malformed-
-- header case: `request.headers` is a JSON object PostgREST itself
-- constructs (the outer structure cannot be malformed), but an
-- individual header VALUE is attacker/client-controlled and casting a
-- non-UUID string straight to ::uuid throws — which would break EVERY
-- policy in the app for that request, not just active-context
-- resolution. A regex guard on the extracted string, checked before any
-- cast is attempted, avoids ever reaching a throwing cast, and keeps
-- this in the same style (STABLE SECURITY DEFINER, language sql) as
-- every other helper in the schema.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · Live bodies of the two functions this migration replaces.
select n.nspname, p.proname, pg_get_functiondef(p.oid)
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  (n.nspname, p.proname) in (('public','my_org_id'), ('public','my_role'));

-- I2 · Every current profile_orgs membership — confirms the "exactly
--      one membership per profile today" assumption this step's
--      invisibility depends on.
select profile_id, count(*) from companion.profile_orgs
where left_at is null group by profile_id having count(*) <> 1;
-- ^ must return zero rows before running, or step 3 is NOT invisible
--   for whoever shows up here.


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

create or replace function public.active_org_id()
returns uuid
language sql stable security definer
set search_path = 'companion', 'public' as $$
  with header as (
    select case
      when (current_setting('request.headers', true)::json ->> 'x-active-org-id')
           ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (current_setting('request.headers', true)::json ->> 'x-active-org-id')::uuid
      else null
    end as org_id
  )
  select coalesce(
    -- Header present and names a plan I'm in: use it, and ONLY it.
    (select po.org_id from companion.profile_orgs po, header h
     where po.profile_id = auth.uid() and po.left_at is null
       and h.org_id is not null and po.org_id = h.org_id),
    -- No usable header (absent OR unparseable — both land here via
    -- h.org_id is null): fall back to my one membership, if I have
    -- exactly one.
    (select po.org_id from companion.profile_orgs po, header h
     where po.profile_id = auth.uid() and po.left_at is null and h.org_id is null
       and (select count(*) from companion.profile_orgs
            where profile_id = auth.uid() and left_at is null) = 1)
  )
$$;

create or replace function public.my_org_id()
returns uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select public.active_org_id()
$$;

create or replace function public.my_role()
returns text language sql stable security definer
set search_path = 'companion', 'public' as $$
  select po.role
  from   companion.profile_orgs po
  where  po.profile_id = auth.uid()
    and  po.left_at is null
    and  po.org_id = public.active_org_id()
  limit  1
$$;

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · Structural — both functions still SECURITY DEFINER with the
--      expected search_path (a plain create-or-replace can't lose
--      this, but confirm rather than assume).
select proname, prosecdef, proconfig from pg_proc
where pronamespace = 'public'::regnamespace and proname in ('my_org_id', 'my_role', 'active_org_id');

-- V2 · Sanity check against real data, substituting each real profile
--      for auth.uid() (a raw SQL-editor session has no request.headers
--      GUC and no JWT, so this is the only path actually exercisable
--      outside a real HTTP call — but it IS the only behaviourally
--      relevant path today, since no frontend sends the header yet).
--      Every row must show org_matches = true and role_matches = true.
select p.id, p.full_name, p.org_id as expected_org_id, p.role as expected_role,
       m.org_id as resolved_org_id, m.role as resolved_role,
       m.org_id = p.org_id as org_matches, m.role = p.role as role_matches
from   companion.profiles p
left   join lateral (
  select po.org_id, po.role
  from   companion.profile_orgs po
  where  po.profile_id = p.id and po.left_at is null
    and  (select count(*) from companion.profile_orgs
          where profile_id = p.id and left_at is null) = 1
  limit  1
) m on true
order  by p.full_name;

-- ── Behavioural — the real test, needs an actual API call (can't be
--    simulated from the SQL editor: no request.headers GUC there).
-- V3 · The context-leak probe (§3.3, §7 item 4) — THE most important
--      test in the whole spec, once step 4 gives someone a second
--      membership to test with. Not exercisable yet: every profile
--      today has exactly one membership, so there is no second context
--      to switch into. Re-run this the moment any profile gets a
--      second profile_orgs row (step 6, linking): with plan A active
--      (header set), querying a plan-A-only-staff-visible table must
--      return plan A's rows; switching the header to plan B must
--      return NONE of plan A's rows, not a merged set.
-- V4 · A request with x-active-org-id set to a plan I am NOT a member
--      of -> the relevant query returns zero rows, not an error and not
--      my real org's rows.
-- V5 · A request with a garbage x-active-org-id (not a UUID at all)
--      behaves identically to sending no header — does not error.
