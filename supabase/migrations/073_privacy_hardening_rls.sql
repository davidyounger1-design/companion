-- ═══════════════════════════════════════════════════════════════════
-- 073 · Privacy & access-control hardening, Pass A  (idempotent)
--
-- Six RLS corrections. No new tables, no schema changes, no frontend
-- changes. Every item fixes a live, verified hole — not a theoretical
-- one. Full rationale: docs/superpowers/specs/2026-08-24-privacy-
-- hardening-design.md. Read that before touching anything here; this
-- file assumes its reasoning and states only what changes.
--
-- INDEPENDENT of 071/072/074/075, all written or applied separately.
-- May run before or after any of them — nothing here references a
-- sub-role, an entitlement, or the log_entries type constraint.
--
-- THE SIX ITEMS:
--   A1  drop the unused "workers can flag notes" UPDATE policy on
--       behaviour_notes — verified dead code (zero UPDATE call sites in
--       src/ or supabase/functions/), and currently lets ANY worker with
--       reach rewrite ANY field of ANY clinical note for that
--       participant, including client_id (re-parenting the note to a
--       different participant and family) and include_in_summary.
--   A2  add a role test to "workers can view behaviour notes" SELECT —
--       today it has none, so anything inside client_ids_for_worker()
--       reads every behaviour note for that participant.
--   A3  fix three medication policies that use client_ids_for_org() as
--       an access grant — today ANY member of an org (family, therapist,
--       the recipient) can read AND WRITE medication administration
--       records for every participant in it.
--   A4  role-test client_ids_for_org() itself — today any org member can
--       enumerate every participant UUID in their org.
--   A5  add the cross-tenant org test to client_ids_for_family() that
--       069 already gave client_ids_for_worker() — a detached family
--       profile currently retains reads against its former org.
--       Deliberately NOT applied to client_ids_for_therapist(), which is
--       correctly person-scoped by product design (confirmed 2026-08-24
--       — a therapist is common to a participant across plans).
--   A6  participant-scope notices and the messages group thread — both
--       carry a not-null client_id and neither SELECT policy checks it,
--       so in a provider org any worker/family/therapist can read notes
--       and group messages about participants they have no connection
--       to. Coordinators keep drawer-wide (org-wide) access, confirmed
--       2026-08-24 — consistent with their existing org-wide access to
--       clients, log_entries and behaviour_notes.
--
-- ⚠ A5's create-or-replace, and A4's, are destructive overwrites of
--   function bodies that may not match these migration files — 060's
--   schema-move sweep has rewritten bodies in place before (069 caught
--   three real discrepancies this way). RECONCILE AGAINST THE INSPECT
--   BLOCK BELOW before running the transaction. This is not optional.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. Run this, keep the output. ═════════
-- It is the rollback record for every create-or-replace below, and the
-- only way to catch a live body that has drifted from what this file
-- assumes.

-- I1 · Live bodies of every function this migration replaces.
select n.nspname, p.proname, pg_get_functiondef(p.oid)
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  (n.nspname, p.proname) in (
         ('public','client_ids_for_org'),
         ('public','client_ids_for_family')
       );

-- I2 · Every policy on behaviour_notes, before A1/A2 touch it.
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr,
       pg_get_expr(polwithcheck, polrelid) as check_expr
from   pg_policy where polrelid = 'companion.behaviour_notes'::regclass
order  by polcmd, polname;

-- I3 · Every caller of client_ids_for_org(), before A4 tightens it.
--      Each must already be coordinator-gated, or fixed by A3 in this
--      same file — if anything else shows up here, STOP and reconcile
--      before running the transaction; A4 would silently zero it out.
select n.nspname, c.relname, pol.polname,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from   pg_policy pol
join   pg_class c on c.oid = pol.polrelid
join   pg_namespace n on n.oid = c.relnamespace
where  coalesce(pg_get_expr(pol.polqual, pol.polrelid),'')
    || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),'') like '%client_ids_for_org%';

-- I4 · Current notices + messages SELECT policies, before A6.
select n.nspname, c.relname, pol.polname,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr
from   pg_policy pol
join   pg_class c on c.oid = pol.polrelid
join   pg_namespace n on n.oid = c.relnamespace
where  c.relname in ('notices','messages') and pol.polcmd = 'r';


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

-- ── A1 · Drop the unused behaviour_notes UPDATE policy ─────────────
drop policy if exists "workers can flag notes" on companion.behaviour_notes;

-- ── A2 · Role-test the behaviour_notes SELECT policy ───────────────
-- IN-list, not a single value: 071 (retires trusted_support_worker) is
-- written but unrun, so this must be correct in either order. Once 071
-- runs, no row holds the retired value and the second element is inert.
drop policy if exists "workers can view behaviour notes" on companion.behaviour_notes;
create policy "workers can view behaviour notes"
  on companion.behaviour_notes for select
  using (
    public.my_role() in ('support_worker','trusted_support_worker')
    and client_id in (select public.client_ids_for_worker())
  );

-- ── A3 · Fix the three medication policies ─────────────────────────
drop policy if exists "can view medications for own client" on companion.medications;
create policy "can view medications for own client"
  on companion.medications for select
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or client_id in (select public.client_ids_for_worker())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
  );

drop policy if exists "can view medication logs for own client" on companion.medication_logs;
create policy "can view medication logs for own client"
  on companion.medication_logs for select
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or client_id in (select public.client_ids_for_worker())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
  );

-- Recipient is deliberately excluded from INSERT — the UI never offers
-- self-administration (FamilyDashboard passes canManage={isCoordinator
-- || isFamily} to MedicationList), so this matches existing behaviour
-- rather than narrowing a live flow.
drop policy if exists "team members can insert medication logs" on companion.medication_logs;
create policy "team members can insert medication logs"
  on companion.medication_logs for insert
  with check (
    administered_by = auth.uid()
    and org_id = public.my_org_id()
    and ( client_id in (select public.client_ids_for_worker())
       or client_id in (select public.client_ids_for_family())
       or (public.my_role() = 'coordinator'
           and client_id in (select public.client_ids_for_org())) )
  );

-- ── A4 · Role-test client_ids_for_org() ────────────────────────────
-- Reconcile against I1 first (see header). Non-org-test portion is
-- unchanged from live; only the added role test is new.
create or replace function public.client_ids_for_org()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select c.id from companion.clients c
  where c.org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
$$;

-- ── A5 · Cross-tenant org test on client_ids_for_family() ──────────
-- Reconcile against I1 first. Deliberately NOT applied to
-- client_ids_for_therapist() — see header and the spec's A5 section;
-- therapist access is person-scoped by product design, not org-scoped.
create or replace function public.client_ids_for_family()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select cf.client_id
  from   companion.client_family cf
  join   companion.clients c on c.id = cf.client_id
  where  cf.family_id = auth.uid()
    and  cf.status = 'active'
    and  c.org_id = public.my_org_id()
$$;

-- ── A6 · Participant-scope notices and the messages group thread ──
-- Coordinators keep org-wide access (confirmed 2026-08-24) — consistent
-- with "coordinators can manage clients" (002) and their existing
-- org-wide read of log_entries (003) and behaviour_notes (004).
drop policy if exists "org members can view notices" on companion.notices;
create policy "org members can view notices"
  on companion.notices for select
  using (
    org_id = public.my_org_id()
    and (
      public.my_role() = 'coordinator'
      or ( public.my_role() in ('support_worker','trusted_support_worker')
           and client_id in (select public.client_ids_for_worker()) )
      or ( public.my_role() = 'family'
           and client_id in (select public.client_ids_for_family()) )
      -- therapist: no access — notices were never part of the note_shares
      -- consent model. recipient: no access — unchanged from 059.
    )
  );

-- Only the group-thread branch changes. The two 1:1 branches
-- (sender_id/recipient_id = auth.uid()) are untouched, verbatim from 057.
drop policy if exists "org members can view messages" on companion.messages;
create policy "org members can view messages"
  on companion.messages for select
  using (
    org_id = public.my_org_id()
    and (
      sender_id = auth.uid()
      or recipient_id = auth.uid()
      or ( recipient_id is null
           and ( public.my_role() = 'coordinator'
                 or ( public.my_role() = 'family'
                      and client_id in (select public.client_ids_for_family()) ) ) )
    )
  );

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════
-- Structural — all should read as expected before any behavioural probe.

-- V1 · "workers can flag notes" is gone; no other UPDATE policy on
--      behaviour_notes was removed with it. Compare against I2.
select polname, polcmd from pg_policy
where polrelid = 'companion.behaviour_notes'::regclass order by polcmd, polname;

-- V2 · No policy anywhere still references client_ids_for_org() outside
--      a coordinator-gated branch. Compare against I3 — every remaining
--      hit must show 'coordinator' in the same expression.
select n.nspname, c.relname, pol.polname,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from   pg_policy pol
join   pg_class c on c.oid = pol.polrelid
join   pg_namespace n on n.oid = c.relnamespace
where  coalesce(pg_get_expr(pol.polqual, pol.polrelid),'')
    || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),'') like '%client_ids_for_org%';

-- V3 · The two rewritten functions are SECURITY DEFINER with the
--      expected search_path.
select proname, prosecdef, proconfig from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('client_ids_for_org','client_ids_for_family');

-- ── Behavioural — run each as a real signed-in user of that role, with
--    header  Accept-Profile: companion / Content-Profile: companion  —
--    without it PostgREST looks in `public` and a 404 proves nothing.

-- V4 · A family member queries medication_logs for a participant they
--      are NOT linked to → expect zero rows.
--   curl "$URL/rest/v1/medication_logs?client_id=eq.<unlinked participant>" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $FAMILY_JWT" \
--     -H "Accept-Profile: companion"

-- V5 · Same family member, INSERT for the unlinked participant → refused
--      (42501). For their OWN linked participant → succeeds. Both halves
--      required — the second proves the fix didn't break the live org.

-- V6 · A therapist queries behaviour_notes → only notes with a live
--      note_shares row, even if they also hold a client_workers row.

-- V7 · A recipient calls rpc/client_ids_for_org → zero rows.

-- V8 · A detached family profile (org_id NULL) queries clients → zero
--      rows.

-- V9 · A support worker queries behaviour_notes for an assigned
--      participant → STILL returns them (proves A2 didn't over-narrow).

-- V10 · Provider org, two participants P1/P2. A worker assigned only to
--       P1 queries notices → only P1's rows. Same worker queries
--       messages where recipient_id is null → only P1's group thread.
--       Then repeat as a coordinator → both P1 and P2 (org-wide,
--       confirmed behaviour, not a regression).
