-- ─────────────────────────────────────────────────────────────
-- 035 · Shared active timer per client   (idempotent)
--
-- A single active_timers row represents "the timer currently running
-- for this client" — whether the recipient started it themself on
-- their own device, or a family member/coordinator started it
-- remotely. One row per client (unique constraint): starting a new
-- timer replaces whatever was running before. Every device viewing
-- that client's Timer page polls this table, so a remotely-started
-- timer appears and counts down automatically with no action needed
-- from the recipient.
--
-- Visibility mirrors schedule_items (026/033): recipient, family, and
-- the org coordinator — not support workers or therapists.
-- ─────────────────────────────────────────────────────────────

create table if not exists active_timers (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  org_id     uuid not null references organisations(id) on delete cascade,
  created_by uuid not null references profiles(id) on delete cascade,
  label      text not null,
  ends_at    timestamptz not null,
  created_at timestamptz not null default now(),
  unique (client_id)
);

alter table active_timers enable row level security;

drop policy if exists "can view active timer for own client"   on active_timers;
drop policy if exists "can start timer for own client"          on active_timers;
drop policy if exists "can cancel timer for own client"         on active_timers;

create policy "can view active timer for own client"
  on active_timers for select
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
  );

create policy "can start timer for own client"
  on active_timers for insert
  with check (
    created_by = auth.uid()
    and org_id = public.my_org_id()
    and (
      client_id in (select public.client_ids_for_recipient())
      or client_id in (select public.client_ids_for_family())
      or (public.my_role() = 'coordinator' and client_id in (select public.client_ids_for_org()))
    )
  );

-- Starting a new timer upserts (on conflict client_id), which requires update
-- privileges too — same visibility as insert.
create policy "can replace timer for own client"
  on active_timers for update
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
  );

create policy "can cancel timer for own client"
  on active_timers for delete
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
  );

-- Grants — RLS above still fully controls actual row access. Tables
-- created outside Supabase's own migration tooling don't automatically
-- inherit the default privileges that expose them via PostgREST (see
-- 033_schedule.sql's note); included from the start this time.
grant select, insert, update, delete on table active_timers to anon, authenticated;
