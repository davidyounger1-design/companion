-- ─────────────────────────────────────────────────────────────
-- 097 · Calendar feeds (idempotent)
--
-- One private, revocable calendar-subscription link per participant. The
-- calendar-feed edge function looks the token up (as service_role) and
-- serves that participant's schedule as an iCalendar (.ics) feed that
-- iPhone Calendar / Google Calendar subscribe to. One-way: calendar apps
-- only read it, nothing flows back into Companion.
--
-- The token is a bearer secret — anyone holding the link can read the
-- schedule — so, unlike day_notes, this table is NOT readable by the
-- recipient and gets no anon grant: only the family/coordinator who manage
-- the schedule can see, create, regenerate (update token) or revoke
-- (delete) a feed. Regenerating swaps in a new token, which immediately
-- stops the old link working.
--
-- timezone: schedule times are stored as bare clock times with no zone, so
-- the feed needs one to place them on the calendar. Limited to the
-- Australian zones the edge function carries VTIMEZONE definitions for.
--
-- reminder_minutes: optional alert before each event (null = no alert).
--
-- Every reference is schema-qualified: a bare table name in a migration
-- resolves against the SQL editor's search_path (public), not companion.
-- ─────────────────────────────────────────────────────────────

create table if not exists companion.calendar_feeds (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references companion.organisations(id) on delete cascade,
  client_id        uuid not null references companion.clients(id) on delete cascade,
  token            text not null unique
                   default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  timezone         text not null default 'Australia/Sydney'
                   check (timezone in (
                     'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane',
                     'Australia/Adelaide', 'Australia/Perth', 'Australia/Darwin', 'Australia/Hobart'
                   )),
  reminder_minutes integer check (reminder_minutes is null or reminder_minutes between 0 and 1440),
  created_by       uuid not null references companion.profiles(id) on delete cascade,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_id)
);

alter table companion.calendar_feeds enable row level security;

drop policy if exists "family/coordinator can view calendar feed"   on companion.calendar_feeds;
drop policy if exists "family/coordinator can create calendar feed" on companion.calendar_feeds;
drop policy if exists "family/coordinator can update calendar feed" on companion.calendar_feeds;
drop policy if exists "family/coordinator can delete calendar feed" on companion.calendar_feeds;

create policy "family/coordinator can view calendar feed"
  on companion.calendar_feeds for select
  using (
    (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
  );

create policy "family/coordinator can create calendar feed"
  on companion.calendar_feeds for insert
  with check (
    created_by = auth.uid()
    and org_id = public.my_org_id()
    and (
      (public.my_role() = 'coordinator' and client_id in (select public.client_ids_for_org()))
      or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
    )
  );

create policy "family/coordinator can update calendar feed"
  on companion.calendar_feeds for update
  using (
    (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
  );

create policy "family/coordinator can delete calendar feed"
  on companion.calendar_feeds for delete
  using (
    (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
  );

-- authenticated already gets select/insert/update/delete from 060's default
-- privileges; stated explicitly here, plus service_role for the edge function.
-- Deliberately no anon grant — the token column is a secret.
grant select, insert, update, delete on table companion.calendar_feeds to authenticated;
grant select on table companion.calendar_feeds to service_role;
