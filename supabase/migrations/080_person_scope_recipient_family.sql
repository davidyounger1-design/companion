-- ═══════════════════════════════════════════════════════════════════
-- 080 · Identity & access model, Step 5 — person-scope the two merge
--       helpers (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-24-identity-access-
-- model-design.md §3.1, §5 step 5. This is the FIRST step in the whole
-- rollout with observable behaviour — and only for a cabinet that
-- actually has a linked drawer, which is nobody until step 6 (linking)
-- exists. Confirmed live 2026-08-24: zero family members currently
-- span more than one org via client_family, so this is invisible for
-- every real user today too.
--
-- TWO DIFFERENT MECHANISMS, per §3.1 — do not conflate them:
--
--   client_ids_for_recipient() now joins through persons.
--   recipient_profile_id instead of clients.recipient_profile_id
--   directly. Both columns still exist and agree (077 copied, did not
--   move) — switching the read to the person-level copy is what makes
--   this return EVERY enrolment of that person once two clients rows
--   share a person_id, instead of just the one enrolment whose own
--   copy happens to match.
--
--   client_ids_for_family() loses its organisation test — the one
--   073/A5 added. This is not a mistake; the spec calls this out
--   explicitly: "A5 is therefore not wasted, but it is temporary...
--   directly replaces the organisation test the privacy-hardening pass
--   adds." Family membership stays at ENROLMENT level (client_family),
--   not person level — deliberately, so a coordinator inviting someone
--   as "family" in their own plan can never hand them another plan's
--   drawer (see §3.1's "why not attach family to the person" for the
--   full reasoning). The org test existed only to stop a detached
--   family profile (org_id gone null) retaining access to its former
--   org — under the merged model, "which orgs does this family member
--   legitimately hold client_family rows in" is itself the intended
--   scope, not a leak to close.
--
-- client_ids_for_therapist() and the note_shares path need NO change —
-- already person-scoped by construction (circle membership + per-note
-- grants), confirmed in the hardening spec and unchanged since.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · Live bodies of both functions this migration replaces.
select n.nspname, p.proname, pg_get_functiondef(p.oid)
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  (n.nspname, p.proname) in (('public','client_ids_for_recipient'), ('public','client_ids_for_family'));

-- I2 · Any family member already spanning more than one org via
--      client_family — must be zero, or removing the org test widens
--      someone's access TODAY, not just once linking exists.
select cf.family_id, count(distinct c.org_id) as distinct_orgs
from   companion.client_family cf join companion.clients c on c.id = cf.client_id
where  cf.status = 'active'
group  by cf.family_id having count(distinct c.org_id) > 1;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

create or replace function public.client_ids_for_recipient()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select c.id
  from   companion.clients c
  join   companion.persons p on p.id = c.person_id
  where  p.recipient_profile_id = auth.uid()
$$;

create or replace function public.client_ids_for_family()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select cf.client_id
  from   companion.client_family cf
  where  cf.family_id = auth.uid()
    and  cf.status = 'active'
$$;

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · Structural — both still SECURITY DEFINER, correct search_path.
select proname, prosecdef, proconfig from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('client_ids_for_recipient', 'client_ids_for_family');

-- V2 · Sanity check against real data — substituting each real
--      recipient/family profile for auth.uid(), the resolved set must
--      equal what the OLD bodies would have returned, since nothing is
--      linked yet. Zero rows means no behaviour change today.
select p.id, p.full_name,
       (select array_agg(c.id order by c.id) from companion.clients c
        join companion.persons per on per.id = c.person_id
        where per.recipient_profile_id = p.id) as new_recipient_result,
       (select array_agg(id order by id) from companion.clients where recipient_profile_id = p.id) as old_recipient_result
from   companion.profiles p
where  p.role = 'recipient';
-- ^ new_recipient_result and old_recipient_result must be identical arrays for every row.

select cf.family_id,
       array_agg(distinct cf.client_id order by cf.client_id) as new_family_result_this_helper_now_returns
from   companion.client_family cf
where  cf.status = 'active'
group  by cf.family_id;
-- ^ compare against what querying with the org filter would have returned (I2 already
--   confirmed no org spans more than one distinct org per family_id, so these are identical).

-- ── Behavioural — needs a real linked cabinet (step 6) to actually
--    exercise the merge; nothing to probe yet.
-- V3 · Once step 6 links a cabinet: the participant's own login
--      (recipient role) sees BOTH enrolments' journal/goals/etc via
--      client_ids_for_recipient(); a family member sees both via
--      client_ids_for_family() PROVIDED they hold an active client_family
--      row on each enrolment (not automatic — family access still has
--      to be explicitly granted per enrolment, same as always).
