-- ═══════════════════════════════════════════════════════════════════
-- 073 · Privacy & access-control hardening, Pass A  (idempotent)
--
-- Six RLS corrections from the spec, plus three more (A4b) found live
-- while reconciling A4 against the actual database. No new tables, no
-- schema changes, no frontend changes. Every item fixes a live,
-- verified hole — not a theoretical one. Full rationale:
-- docs/superpowers/specs/2026-08-24-privacy-hardening-design.md. Read
-- that before touching anything here; this file assumes its reasoning
-- and states only what changes (A4b is not in that spec — it exists
-- purely to keep A4 from breaking real live functionality).
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
--      Each must already be coordinator-gated, or fixed by A3/A4b in
--      this same file — if anything else shows up here, STOP and
--      reconcile before running the transaction; A4 would silently
--      zero it out. (A4b's three policies were found by running this
--      exact query directly against live, after A1-A6 were first
--      drafted — that is why they aren't already listed as an I-block
--      finding above; this query is what found them.)
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

-- ── A4b · Three more client_ids_for_org() callers, found live ──────
--
-- Discovered via a direct I3 read-only query against the live DB
-- (see chat, not captured as an I-block above since it was run after
-- this file's first commit) — NOT in the original six-item plan.
-- Once A4 above makes client_ids_for_org() return nothing for a
-- non-coordinator, these three policies silently lose all access for
-- the family role and for workers, breaking real live functionality —
-- the one live org today is a family plan, so the first two are
-- capabilities family members actually use.
--
--   "family can manage client_workers" (companion.client_workers,
--   polcmd='*') and "family can manage client_family"
--   (companion.client_family, polcmd='*') both gate on role='family'
--   but scope on the bare, unrestricted client_ids_for_org() — after
--   A4 that returns empty for family, so both policies go from
--   "org-wide reach" (already too broad — the actual gap this closes)
--   straight to "no access at all" instead of the correct
--   "this family's own linked participants."
--
--   "can view photos for visible entries" (companion.log_entry_photos,
--   polcmd='r') has a bare client_ids_for_org() OR-term with no role
--   test — support workers currently rely on it for photo access since
--   there is no dedicated worker clause. Replaced with the same
--   recipient/family/worker/coordinator shape used elsewhere, so photo
--   access for a log entry tracks exactly who can already see that
--   entry (companion.log_entries), not "anyone in the org."
drop policy if exists "family can manage client_workers" on companion.client_workers;
create policy "family can manage client_workers"
  on companion.client_workers for all
  using (
    public.my_role() = 'family'
    and client_id in (select public.client_ids_for_family())
  );

drop policy if exists "family can manage client_family" on companion.client_family;
create policy "family can manage client_family"
  on companion.client_family for all
  using (
    public.my_role() = 'family'
    and client_id in (select public.client_ids_for_family())
  );

drop policy if exists "can view photos for visible entries" on companion.log_entry_photos;
create policy "can view photos for visible entries"
  on companion.log_entry_photos for select
  using (
    exists (
      select 1 from companion.log_entries le
      where le.id = log_entry_photos.entry_id
        and ( le.client_id in (select public.client_ids_for_recipient())
           or le.client_id in (select public.client_ids_for_family())
           or le.client_id in (select public.client_ids_for_worker())
           or (le.org_id = public.my_org_id() and public.my_role() = 'coordinator') )
    )
  );

-- ── A6 · Participant-scope notices and the messages group thread ──
--
-- CORRECTED 2026-08-24 after the I4 inspect results came back — live
-- reality differs from every migration file for both tables, in a way
-- that would have made the originally-drafted fix here a no-op:
--
--   notices:  the ONLY live SELECT policy is "view notices" — org-wide,
--             NO role check at all (not even excluding recipient). It
--             exists in NO migration file (grepped all 72 prior files).
--             059's "org members can view notices" (which DOES exclude
--             recipient) was apparently never actually applied — only
--             "view notices" is live. Worse than this spec originally
--             documented: recipients currently CAN read notices.
--
--   messages: TWO live permissive SELECT policies both apply (Postgres
--             ORs permissive policies) — "org members can view messages"
--             (043/044's org_type-aware shape, matches no later file
--             verbatim either) AND "view messages" (also in NO migration
--             file). Working through both combined: coordinators already
--             get unconditional org-wide access; support workers only
--             ever get their own 1:1 threads and never had group-thread
--             access to lose. The one real leak is family: both policies
--             grant "recipient_id is null" group-thread access to ANY
--             family-role user, with no check against which participant
--             they are actually linked to via client_family.
--
--   Preserved deliberately: the org_type = 'family' branch, which grants
--   coordinator+family UNCONDITIONAL message access with no participant
--   check at all. That is exactly the one real live org. A naive fix
--   would have narrowed this — a real behaviour change nobody asked
--   for — so it is kept verbatim and only PROVIDER-org family access
--   gains participant scoping.
--
-- Drops BOTH the documented and the undocumented policy on each table —
-- dropping only the documented one would leave the undocumented
-- duplicate fully in force underneath the new policy, nullifying the fix.
drop policy if exists "view notices" on companion.notices;
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
      -- consent model. recipient: no access — this is the actual fix;
      -- previously granted with no role check at all.
    )
  );

drop policy if exists "org members can view messages" on companion.messages;
drop policy if exists "view messages" on companion.messages;
create policy "org members can view messages"
  on companion.messages for select
  using (
    org_id = public.my_org_id()
    and (
      sender_id = auth.uid()
      or recipient_id = auth.uid()
      or public.my_role() = 'coordinator'
      -- Family org: UNCHANGED from live behaviour — unconditional, no
      -- participant check. Single-participant orgs, so nothing to leak.
      or ( public.my_org_type() = 'family' and public.my_role() = 'family' )
      -- Provider org: THE FIX — group thread scoped to participants this
      -- family member is actually linked to, instead of every participant
      -- in the org.
      or ( public.my_org_type() <> 'family'
           and public.my_role() = 'family'
           and recipient_id is null
           and client_id in (select public.client_ids_for_family()) )
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
