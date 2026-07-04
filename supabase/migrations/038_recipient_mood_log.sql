-- ─────────────────────────────────────────────────────────────
-- 038 · Recipient mood log   (idempotent)
--
-- Recipients no longer see the mood_score attached to entries other
-- people log about them (that's an RLS-unrelated client-side change —
-- see FamilyDashboard.tsx). Instead they get their own self-reported
-- mood log: a simple "how are you feeling right now" check-in they can
-- add whenever they like, visible to their whole circle (coordinator,
-- family, assigned workers, circle therapists) — mirrors the
-- client_feedback table from 026_recipient_role.sql exactly, just with
-- a mood score instead of free text.
-- ─────────────────────────────────────────────────────────────

create table if not exists recipient_moods (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  org_id     uuid not null references organisations(id) on delete cascade,
  author_id  uuid not null references profiles(id) on delete cascade,
  mood_score int not null check (mood_score between 0 and 100),
  note       text,
  created_at timestamptz not null default now()
);

alter table recipient_moods enable row level security;

drop policy if exists "recipient can view own mood log"             on recipient_moods;
drop policy if exists "recipient can add own mood"                  on recipient_moods;
drop policy if exists "recipient can delete own recent mood"        on recipient_moods;
drop policy if exists "coordinators can view org mood logs"         on recipient_moods;
drop policy if exists "coordinators can delete org mood logs"       on recipient_moods;
drop policy if exists "family can view mood logs for their clients" on recipient_moods;
drop policy if exists "workers can view mood logs for assigned clients" on recipient_moods;
drop policy if exists "therapists can view mood logs for circle clients" on recipient_moods;

create policy "recipient can view own mood log"
  on recipient_moods for select
  using (client_id in (select public.client_ids_for_recipient()));

create policy "recipient can add own mood"
  on recipient_moods for insert
  with check (
    author_id = auth.uid()
    and public.my_role() = 'recipient'
    and client_id in (select public.client_ids_for_recipient())
  );

create policy "recipient can delete own recent mood"
  on recipient_moods for delete
  using (
    author_id = auth.uid()
    and public.my_role() = 'recipient'
    and created_at > now() - interval '60 seconds'
  );

create policy "coordinators can view org mood logs"
  on recipient_moods for select
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
  );

create policy "coordinators can delete org mood logs"
  on recipient_moods for delete
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
  );

create policy "family can view mood logs for their clients"
  on recipient_moods for select
  using (client_id in (select public.client_ids_for_family()));

create policy "workers can view mood logs for assigned clients"
  on recipient_moods for select
  using (client_id in (select public.client_ids_for_worker()));

create policy "therapists can view mood logs for circle clients"
  on recipient_moods for select
  using (client_id in (select public.client_ids_for_therapist()));

-- New tables created via SQL Editor don't inherit Supabase's automatic
-- default privileges — explicit grants required (see 033/034/035).
grant select, insert, delete on table recipient_moods to authenticated;
