-- ─────────────────────────────────────────────────────────────
-- 063 · Day notes (idempotent)
--
-- An optional, once-off note pinned to a single calendar day on the
-- schedule — not a recurring schedule item, not a general journal entry.
-- For things like "Grandma's visiting today" or "No school — pupil free
-- day" that need to stand out at the top of that one day's view. Most
-- days won't have one; at most one note per client per date.
--
-- Visibility and management mirror schedule_items (033): the recipient,
-- their family, and the org coordinator can see it; only family/coordinator
-- can create, edit, or delete it (same split as who manages the schedule
-- itself).
--
-- day_notes lives directly in the companion schema — created after the
-- 060 schema move, so no move step is needed, but every reference here is
-- still schema-qualified since a bare table name in a migration resolves
-- against the SQL editor session's own search_path (public), not companion.
-- ─────────────────────────────────────────────────────────────

create table if not exists companion.day_notes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references companion.organisations(id) on delete cascade,
  client_id     uuid not null references companion.clients(id) on delete cascade,
  note_date     date not null,
  body          text not null,
  created_by    uuid not null references companion.profiles(id) on delete cascade,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (client_id, note_date)
);

alter table companion.day_notes enable row level security;

drop policy if exists "can view day notes for own client"      on companion.day_notes;
drop policy if exists "family/coordinator can create day notes" on companion.day_notes;
drop policy if exists "family/coordinator can update day notes" on companion.day_notes;
drop policy if exists "family/coordinator can delete day notes" on companion.day_notes;

create policy "can view day notes for own client"
  on companion.day_notes for select
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
  );

create policy "family/coordinator can create day notes"
  on companion.day_notes for insert
  with check (
    created_by = auth.uid()
    and org_id = public.my_org_id()
    and (
      (public.my_role() = 'coordinator' and client_id in (select public.client_ids_for_org()))
      or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
    )
  );

create policy "family/coordinator can update day notes"
  on companion.day_notes for update
  using (
    (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
  );

create policy "family/coordinator can delete day notes"
  on companion.day_notes for delete
  using (
    (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
  );

grant select, insert, update, delete on table companion.day_notes to anon, authenticated;
