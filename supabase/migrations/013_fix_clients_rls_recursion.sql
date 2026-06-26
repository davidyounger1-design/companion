-- ─────────────────────────────────────────────────────────────
-- 013 · Fix infinite-recursion between clients and its child tables  (idempotent)
--
-- Root cause (live error: 42P17 "infinite recursion detected in
-- policy for relation \"clients\""):
--
--   • clients SELECT policies (migration 002) subquery client_workers /
--     client_family / client_circle.
--   • Those child tables' coordinator/family policies (006/011) subquery
--     clients right back.
--   → clients → client_workers → clients → …  ⇒ Postgres aborts every
--     query that touches clients (and, by extension, log_entries,
--     behaviour_notes, note_shares, access_log, messages).
--
-- This is why the coordinator dashboard shows "0 participants" (the
-- clients query errors and the UI defaults to an empty list) and why
-- "Add participant" fails — the INSERT hits the same recursive policy.
--
-- Fix: the same trick migration 006 used for the profiles loop —
-- SECURITY DEFINER helper functions bypass RLS, so cross-table lookups
-- no longer re-enter a policy. Every recursive subquery is rewritten to
-- call one of these helpers instead of inlining a subquery on an
-- RLS-protected table.
-- ─────────────────────────────────────────────────────────────

-- ── 1. SECURITY DEFINER membership helpers ───────────────────
-- (owned by postgres → bypass RLS on the tables they read)

create or replace function public.client_ids_for_worker()
returns setof uuid language sql stable security definer set search_path = public as $$
  select client_id from client_workers where worker_id = auth.uid()
$$;

create or replace function public.client_ids_for_family()
returns setof uuid language sql stable security definer set search_path = public as $$
  select client_id from client_family where family_id = auth.uid() and status = 'active'
$$;

create or replace function public.client_ids_for_therapist()
returns setof uuid language sql stable security definer set search_path = public as $$
  select client_id from client_circle where therapist_id = auth.uid() and status = 'in_circle'
$$;

create or replace function public.client_ids_for_org()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from clients where org_id = public.my_org_id()
$$;

create or replace function public.client_ids_for_decision_maker()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from clients where decision_maker_id = auth.uid()
$$;

create or replace function public.note_ids_for_decision_maker()
returns setof uuid language sql stable security definer set search_path = public as $$
  select bn.id
  from behaviour_notes bn
  join clients c on c.id = bn.client_id
  where c.decision_maker_id = auth.uid()
$$;

create or replace function public.note_ids_for_org_coordinator()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from behaviour_notes
  where org_id = public.my_org_id() and public.my_role() = 'coordinator'
$$;

create or replace function public.shared_note_ids_for_therapist()
returns setof uuid language sql stable security definer set search_path = public as $$
  select note_id from note_shares
  where therapist_id = auth.uid() and revoked_at is null
$$;

grant execute on function
  public.client_ids_for_worker(),
  public.client_ids_for_family(),
  public.client_ids_for_therapist(),
  public.client_ids_for_org(),
  public.client_ids_for_decision_maker(),
  public.note_ids_for_decision_maker(),
  public.note_ids_for_org_coordinator(),
  public.shared_note_ids_for_therapist()
  to authenticated;

-- ── 2. clients ───────────────────────────────────────────────

drop policy if exists "workers can view assigned clients"   on clients;
drop policy if exists "family can view their clients"        on clients;
drop policy if exists "therapists can view circle clients"   on clients;

create policy "workers can view assigned clients"
  on clients for select
  using (id in (select public.client_ids_for_worker()));

create policy "family can view their clients"
  on clients for select
  using (id in (select public.client_ids_for_family()));

create policy "therapists can view circle clients"
  on clients for select
  using (id in (select public.client_ids_for_therapist()));

-- (coordinator / family "manage clients" policies from 006 & 011 use
--  my_org_id()/my_role() only — already recursion-free, left as-is.)

-- ── 3. client_workers ────────────────────────────────────────

drop policy if exists "coordinators can manage client_workers" on client_workers;
drop policy if exists "family can manage client_workers"       on client_workers;

create policy "coordinators can manage client_workers"
  on client_workers for all
  using (
    public.my_role() = 'coordinator'
    and client_id in (select public.client_ids_for_org())
  );

create policy "family can manage client_workers"
  on client_workers for all
  using (
    public.my_role() = 'family'
    and client_id in (select public.client_ids_for_org())
  );

-- ── 4. client_family ─────────────────────────────────────────

drop policy if exists "coordinators can manage client_family" on client_family;
drop policy if exists "family can manage client_family"       on client_family;

create policy "coordinators can manage client_family"
  on client_family for all
  using (
    public.my_role() = 'coordinator'
    and client_id in (select public.client_ids_for_org())
  );

create policy "family can manage client_family"
  on client_family for all
  using (
    public.my_role() = 'family'
    and client_id in (select public.client_ids_for_org())
  );

-- ── 5. client_circle ─────────────────────────────────────────

drop policy if exists "coordinators can manage circle"   on client_circle;
drop policy if exists "decision_maker can manage circle" on client_circle;

create policy "coordinators can manage circle"
  on client_circle for all
  using (
    public.my_role() = 'coordinator'
    and client_id in (select public.client_ids_for_org())
  );

create policy "decision_maker can manage circle"
  on client_circle for all
  using (client_id in (select public.client_ids_for_decision_maker()));

-- ── 6. log_entries ───────────────────────────────────────────

drop policy if exists "workers can log for assigned clients"          on log_entries;
drop policy if exists "family can view log entries"                   on log_entries;
drop policy if exists "family can log for their participant"          on log_entries;
drop policy if exists "trusted workers can log for assigned clients"  on log_entries;

create policy "workers can log for assigned clients"
  on log_entries for insert
  with check (
    author_id = auth.uid()
    and client_id in (select public.client_ids_for_worker())
  );

create policy "family can view log entries"
  on log_entries for select
  using (client_id in (select public.client_ids_for_family()));

create policy "family can log for their participant"
  on log_entries for insert
  with check (
    public.my_role() = 'family'
    and author_id = auth.uid()
    and org_id = public.my_org_id()
    and client_id in (select public.client_ids_for_family())
  );

create policy "trusted workers can log for assigned clients"
  on log_entries for insert
  with check (
    public.my_role() = 'trusted_support_worker'
    and author_id = auth.uid()
    and client_id in (select public.client_ids_for_worker())
  );

-- ── 7. behaviour_notes ───────────────────────────────────────

drop policy if exists "workers can create behaviour notes"          on behaviour_notes;
drop policy if exists "workers can view behaviour notes"            on behaviour_notes;
drop policy if exists "workers can flag notes"                      on behaviour_notes;
drop policy if exists "decision_maker can view behaviour notes"     on behaviour_notes;
drop policy if exists "therapists see only explicitly shared notes" on behaviour_notes;

create policy "workers can create behaviour notes"
  on behaviour_notes for insert
  with check (
    author_id = auth.uid()
    and client_id in (select public.client_ids_for_worker())
  );

create policy "workers can view behaviour notes"
  on behaviour_notes for select
  using (client_id in (select public.client_ids_for_worker()));

create policy "workers can flag notes"
  on behaviour_notes for update
  using (client_id in (select public.client_ids_for_worker()));

create policy "decision_maker can view behaviour notes"
  on behaviour_notes for select
  using (
    client_id in (select public.client_ids_for_decision_maker())
    or client_id in (select public.client_ids_for_family())
  );

create policy "therapists see only explicitly shared notes"
  on behaviour_notes for select
  using (id in (select public.shared_note_ids_for_therapist()));

-- ── 8. note_shares ───────────────────────────────────────────

drop policy if exists "decision_maker can share notes"        on note_shares;
drop policy if exists "decision_maker can revoke note shares" on note_shares;
drop policy if exists "decision_maker can view note shares"   on note_shares;
drop policy if exists "coordinators can view note_shares"     on note_shares;

create policy "decision_maker can share notes"
  on note_shares for insert
  with check (
    shared_by = auth.uid()
    and note_id in (select public.note_ids_for_decision_maker())
  );

create policy "decision_maker can revoke note shares"
  on note_shares for update
  using (note_id in (select public.note_ids_for_decision_maker()));

create policy "decision_maker can view note shares"
  on note_shares for select
  using (note_id in (select public.note_ids_for_decision_maker()));

create policy "coordinators can view note_shares"
  on note_shares for select
  using (note_id in (select public.note_ids_for_org_coordinator()));

-- (therapists "can view their shares" → therapist_id = auth.uid(),
--  already recursion-free, left as-is.)

-- ── 9. access_log ────────────────────────────────────────────

drop policy if exists "decision_maker and coordinator can view access log" on access_log;

create policy "decision_maker and coordinator can view access log"
  on access_log for select
  using (
    actor_id = auth.uid()
    or note_id in (select public.note_ids_for_decision_maker())
    or note_id in (select public.note_ids_for_org_coordinator())
  );

-- ── 10. messages ─────────────────────────────────────────────

drop policy if exists "org members can view messages" on messages;

create policy "org members can view messages"
  on messages for select
  using (
    (org_id = public.my_org_id() and public.my_role() in ('coordinator','support_worker','trusted_support_worker'))
    or client_id in (select public.client_ids_for_family())
  );
