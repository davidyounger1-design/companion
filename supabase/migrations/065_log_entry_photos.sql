-- ─────────────────────────────────────────────────────────────
-- 065 · Multi-photo support for journal entries (idempotent)
--
-- A separate log_entry_photos table (one row per photo) so a
-- single journal entry can carry multiple photos/videos, with
-- per-photo metadata (sort_order) and future-proofing for captions.
--
-- Existing photo_path / photo_thumb_path columns on log_entries are
-- kept indefinitely — new code reads from log_entry_photos first and
-- falls back to the legacy columns for entries created before this
-- migration was applied.
--
-- The backfill INSERT moves every existing single photo into the new
-- table so they show up via the same gallery display path.
-- ─────────────────────────────────────────────────────────────

create table if not exists companion.log_entry_photos (
  id                uuid primary key default gen_random_uuid(),
  entry_id          uuid not null references companion.log_entries(id) on delete cascade,
  photo_path        text not null,
  photo_thumb_path  text,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);

alter table companion.log_entry_photos enable row level security;

drop policy if exists "can view photos for visible entries"      on companion.log_entry_photos;
drop policy if exists "can insert photos for own entries"        on companion.log_entry_photos;
drop policy if exists "author/coordinator can delete photos"     on companion.log_entry_photos;

-- View: inherit visibility from the parent log_entry — same helpers
-- the log_entries policies use to decide who can see each entry.
create policy "can view photos for visible entries"
  on companion.log_entry_photos for select
  using (
    exists (
      select 1 from companion.log_entries le
      where le.id = entry_id
        and (
          le.client_id in (select public.client_ids_for_recipient())
          or le.client_id in (select public.client_ids_for_family())
          or le.client_id in (select public.client_ids_for_org())
          or (le.org_id = public.my_org_id() and public.my_role() = 'coordinator')
        )
    )
  );

-- Insert: must be the entry author AND belong to the current org.
create policy "can insert photos for own entries"
  on companion.log_entry_photos for insert
  with check (
    exists (
      select 1 from companion.log_entries le
      where le.id = entry_id
        and le.author_id = auth.uid()
        and le.org_id = public.my_org_id()
    )
  );

-- Delete: entry author or org coordinator.
create policy "author/coordinator can delete photos"
  on companion.log_entry_photos for delete
  using (
    exists (
      select 1 from companion.log_entries le
      where le.id = entry_id
        and (
          le.author_id = auth.uid()
          or (public.my_role() = 'coordinator' and le.org_id = public.my_org_id())
        )
    )
  );

grant select, insert, delete on table companion.log_entry_photos to anon, authenticated;

-- Backfill: move every existing single photo into the new table so
-- they render through the same gallery display path immediately.
insert into companion.log_entry_photos (entry_id, photo_path, photo_thumb_path)
  select id, photo_path, photo_thumb_path
  from companion.log_entries
  where photo_path is not null
    and id not in (select entry_id from companion.log_entry_photos);
