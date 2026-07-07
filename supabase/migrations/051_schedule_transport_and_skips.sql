-- ─────────────────────────────────────────────────────────────
-- 051 · Transport category + single-occurrence skips   (idempotent)
--
-- Two schedule improvements:
--   1. 'transport' joins the category list (getting to/from an
--      activity is its own thing worth showing on the timeline).
--   2. A weekly item can be removed for ONE day without deleting the
--      whole recurring series. We record a "skip" for that item on
--      that occurrence date; the app hides the occurrence but the
--      series keeps running every other week.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Allow the new 'transport' category ──────────────────────
-- A CHECK constraint can't be altered in place — drop and re-add.

alter table schedule_items drop constraint if exists schedule_items_category_check;
alter table schedule_items add  constraint schedule_items_category_check
  check (category in ('therapy','meal','activity','personal_care','social','appointment','transport','other'));

-- ── 2. schedule_item_skips ──────────────────────────────────────
-- One row = "this item does not occur on this date". Scoped to a
-- single occurrence date, exactly like completions/notes, so skipping
-- a recurring item's Tuesday doesn't touch next Tuesday.

create table if not exists schedule_item_skips (
  id                uuid primary key default gen_random_uuid(),
  schedule_item_id  uuid not null references schedule_items(id) on delete cascade,
  occurrence_date   date not null,
  org_id            uuid not null references organisations(id) on delete cascade,
  client_id         uuid not null references clients(id) on delete cascade,
  created_by        uuid not null references profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (schedule_item_id, occurrence_date)
);

alter table schedule_item_skips enable row level security;

drop policy if exists "can view skips on visible schedule items"   on schedule_item_skips;
drop policy if exists "can skip an occurrence they can manage"      on schedule_item_skips;
drop policy if exists "can un-skip an occurrence they can manage"   on schedule_item_skips;

-- Anyone who can see the schedule sees the skip (so the occurrence
-- disappears for them too).
create policy "can view skips on visible schedule items"
  on schedule_item_skips for select
  using (public.can_view_schedule_item(schedule_item_id));

-- Only people who could delete the underlying item may skip one of its
-- occurrences: the coordinator, the client's family, or a recipient for
-- an item they created themselves. Mirrors the delete policies on
-- schedule_items (033 + 040).
create policy "can skip an occurrence they can manage"
  on schedule_item_skips for insert
  with check (
    created_by = auth.uid()
    and public.can_view_schedule_item(schedule_item_id)
    and (
      (public.my_role() = 'coordinator' and org_id = public.my_org_id())
      or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
      or (
        public.my_role() = 'recipient'
        and exists (select 1 from schedule_items si where si.id = schedule_item_id and si.created_by = auth.uid())
      )
    )
  );

create policy "can un-skip an occurrence they can manage"
  on schedule_item_skips for delete
  using (
    public.can_view_schedule_item(schedule_item_id)
    and (
      (public.my_role() = 'coordinator' and org_id = public.my_org_id())
      or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
      or (
        public.my_role() = 'recipient'
        and exists (select 1 from schedule_items si where si.id = schedule_item_id and si.created_by = auth.uid())
      )
    )
  );

-- ── 3. Grants ───────────────────────────────────────────────────
-- RLS above fully controls row access; this just exposes the table to
-- PostgREST, matching every other table in this schema.
grant select, insert, update, delete on table schedule_item_skips to anon, authenticated;
