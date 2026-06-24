-- ─────────────────────────────────────────────────────────────
-- 006 · Fix infinite-recursion in profiles RLS   (idempotent)
--
-- Root cause: "org members can view each other" on profiles
-- queries profiles from within a profiles policy → infinite loop.
-- Fix: security-definer helper functions bypass RLS on profiles.
-- ─────────────────────────────────────────────────────────────

-- Helper: returns the current user's org_id without triggering RLS
create or replace function public.my_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from public.profiles where id = auth.uid() limit 1
$$;

-- Helper: returns the current user's role
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() limit 1
$$;

-- ── Re-create the recursive policy using the helper ───────────

drop policy if exists "org members can view each other" on profiles;

create policy "org members can view each other"
  on profiles for select
  using (
    org_id is not null
    and org_id = public.my_org_id()
  );

-- ── Rebuild organisation policies using helpers (avoids cascading recursion) ──

drop policy if exists "org members can view their org"              on organisations;
drop policy if exists "org members can insert (during signup via app)" on organisations;
drop policy if exists "coordinators can update their org"           on organisations;

create policy "org members can view their org"
  on organisations for select
  using (id = public.my_org_id());

create policy "org members can insert (during signup via app)"
  on organisations for insert
  with check (true);

create policy "coordinators can update their org"
  on organisations for update
  using (id = public.my_org_id() and public.my_role() = 'coordinator');

-- ── Rebuild org_settings policies ────────────────────────────

drop policy if exists "org members can view settings"    on org_settings;
drop policy if exists "coordinators can manage settings" on org_settings;

create policy "org members can view settings"
  on org_settings for select
  using (org_id = public.my_org_id());

create policy "coordinators can manage settings"
  on org_settings for all
  using (org_id = public.my_org_id() and public.my_role() = 'coordinator');

-- ── Rebuild clients policies ──────────────────────────────────

drop policy if exists "coordinators can manage clients"    on clients;

create policy "coordinators can manage clients"
  on clients for all
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
  );

-- ── Rebuild client_workers policies ──────────────────────────

drop policy if exists "coordinators can manage client_workers" on client_workers;

create policy "coordinators can manage client_workers"
  on client_workers for all
  using (
    client_id in (
      select id from clients
      where org_id = public.my_org_id()
    )
    and public.my_role() = 'coordinator'
  );

-- ── Rebuild client_family policies ───────────────────────────

drop policy if exists "coordinators can manage client_family" on client_family;

create policy "coordinators can manage client_family"
  on client_family for all
  using (
    client_id in (
      select id from clients
      where org_id = public.my_org_id()
    )
    and public.my_role() = 'coordinator'
  );

-- ── Rebuild client_circle policies ───────────────────────────

drop policy if exists "coordinators can manage circle" on client_circle;

create policy "coordinators can manage circle"
  on client_circle for all
  using (
    client_id in (
      select id from clients
      where org_id = public.my_org_id()
    )
    and public.my_role() = 'coordinator'
  );

-- ── Rebuild log_entries policies ─────────────────────────────

drop policy if exists "workers can log for assigned clients"       on log_entries;
drop policy if exists "workers can view logs for assigned clients"  on log_entries;
drop policy if exists "coordinators can view org log entries"       on log_entries;

create policy "workers can log for assigned clients"
  on log_entries for insert
  with check (
    author_id = auth.uid()
    and client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

create policy "workers can view logs for assigned clients"
  on log_entries for select
  using (
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

create policy "coordinators can view org log entries"
  on log_entries for select
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
  );

-- ── Rebuild behaviour_notes policies ─────────────────────────

drop policy if exists "coordinators can view behaviour notes" on behaviour_notes;

create policy "coordinators can view behaviour notes"
  on behaviour_notes for select
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
  );

-- ── Rebuild messages policies ─────────────────────────────────

drop policy if exists "org members can view messages" on messages;
drop policy if exists "org members can send messages"  on messages;

create policy "org members can view messages"
  on messages for select
  using (
    (org_id = public.my_org_id() and public.my_role() in ('coordinator','support_worker'))
    or client_id in (
      select client_id from client_family where family_id = auth.uid() and status = 'active'
    )
  );

create policy "org members can send messages"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and org_id = public.my_org_id()
  );

-- ── Rebuild invites policies ──────────────────────────────────

drop policy if exists "coordinators can manage invites" on invites;

create policy "coordinators can manage invites"
  on invites for all
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
  );
