-- ─────────────────────────────────────────────────────────────
-- 033 · Care schedule for recipients   (idempotent)
--
-- Family members and the coordinator build a day/week schedule for
-- a client. The client (when they hold the 'recipient' role) sees
-- it as a timeline: what's on, what's next, and how long until it
-- starts. Recipients, family, and the coordinator can leave notes
-- against a specific occurrence and check items off as done.
--
-- An item is either a one-off (a specific date) or weekly-recurring
-- (a set of weekday numbers, 0=Sunday..6=Saturday — matches JS
-- Date#getDay(), which the frontend uses directly). Notes and
-- completions are scoped to a single occurrence date, so a note left
-- on a recurring item's Tuesday doesn't leak onto next Tuesday.
--
-- Visibility mirrors the client_feedback model from 026: the
-- recipient themself, their family, and the org coordinator — not
-- support workers or therapists.
-- ─────────────────────────────────────────────────────────────

-- ── 1. schedule_items ─────────────────────────────────────────

create table if not exists schedule_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organisations(id) on delete cascade,
  client_id     uuid not null references clients(id) on delete cascade,
  created_by    uuid not null references profiles(id) on delete cascade,
  title         text not null,
  description   text,
  category      text not null default 'other',
  start_time    time not null,
  end_time      time,
  recurrence    text not null,
  specific_date date,
  days_of_week  smallint[],
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint schedule_items_category_check
    check (category in ('therapy','meal','activity','personal_care','social','appointment','other')),
  constraint schedule_items_recurrence_check
    check (recurrence in ('once','weekly')),
  constraint schedule_items_pattern_check
    check (
      (recurrence = 'once'   and specific_date is not null and days_of_week is null)
      or
      (recurrence = 'weekly' and days_of_week is not null and specific_date is null)
    )
);

alter table schedule_items enable row level security;

drop policy if exists "can view schedule for own client"       on schedule_items;
drop policy if exists "family/coordinator can create schedule"  on schedule_items;
drop policy if exists "family/coordinator can update schedule"  on schedule_items;
drop policy if exists "family/coordinator can delete schedule"  on schedule_items;

create policy "can view schedule for own client"
  on schedule_items for select
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
  );

create policy "family/coordinator can create schedule"
  on schedule_items for insert
  with check (
    created_by = auth.uid()
    and org_id = public.my_org_id()
    and (
      (public.my_role() = 'coordinator' and client_id in (select public.client_ids_for_org()))
      or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
    )
  );

create policy "family/coordinator can update schedule"
  on schedule_items for update
  using (
    (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
  );

create policy "family/coordinator can delete schedule"
  on schedule_items for delete
  using (
    (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
  );

-- ── 2. Visibility helper (mirrors can_view_log_entry from 030) ─

create or replace function public.can_view_schedule_item(p_schedule_item_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from schedule_items si
    where si.id = p_schedule_item_id
      and (
        si.client_id in (select public.client_ids_for_recipient())
        or si.client_id in (select public.client_ids_for_family())
        or (si.org_id = public.my_org_id() and public.my_role() = 'coordinator')
      )
  )
$$;

-- ── 3. schedule_item_notes ──────────────────────────────────────

create table if not exists schedule_item_notes (
  id                uuid primary key default gen_random_uuid(),
  schedule_item_id  uuid not null references schedule_items(id) on delete cascade,
  occurrence_date   date not null,
  org_id            uuid not null references organisations(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  author_id         uuid not null references profiles(id) on delete cascade,
  body              text not null,
  created_at        timestamptz not null default now()
);

alter table schedule_item_notes enable row level security;

drop policy if exists "can view notes on visible schedule items" on schedule_item_notes;
drop policy if exists "can add notes to visible schedule items"  on schedule_item_notes;

create policy "can view notes on visible schedule items"
  on schedule_item_notes for select
  using (public.can_view_schedule_item(schedule_item_id));

create policy "can add notes to visible schedule items"
  on schedule_item_notes for insert
  with check (
    author_id = auth.uid()
    and public.can_view_schedule_item(schedule_item_id)
  );

-- ── 4. schedule_item_completions ────────────────────────────────

create table if not exists schedule_item_completions (
  id                uuid primary key default gen_random_uuid(),
  schedule_item_id  uuid not null references schedule_items(id) on delete cascade,
  occurrence_date   date not null,
  org_id            uuid not null references organisations(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  completed_by      uuid not null references profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (schedule_item_id, occurrence_date)
);

alter table schedule_item_completions enable row level security;

drop policy if exists "can view completions on visible schedule items" on schedule_item_completions;
drop policy if exists "can mark visible schedule items done"           on schedule_item_completions;
drop policy if exists "can unmark done on visible schedule items"      on schedule_item_completions;

create policy "can view completions on visible schedule items"
  on schedule_item_completions for select
  using (public.can_view_schedule_item(schedule_item_id));

create policy "can mark visible schedule items done"
  on schedule_item_completions for insert
  with check (
    completed_by = auth.uid()
    and public.can_view_schedule_item(schedule_item_id)
  );

create policy "can unmark done on visible schedule items"
  on schedule_item_completions for delete
  using (public.can_view_schedule_item(schedule_item_id));
