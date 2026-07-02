-- ─────────────────────────────────────────────────────────────
-- 032 · Entries: edit own only + thumbs-up/heart reactions
--
-- 1. log_entries never had an UPDATE policy at all (checked across
--    every prior migration) — edits were silently rejected for
--    everyone, including the entry's own author. Adds exactly one
--    rule: you can edit an entry only if you wrote it.
--
-- 2. log_entry_reactions: same visibility rule as comments (027) —
--    anyone who can see an entry can react to it with a thumbs-up
--    and/or heart, and remove their own reaction.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "authors can update own log entries" on log_entries;

create policy "authors can update own log entries"
  on log_entries for update
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create table if not exists log_entry_reactions (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references log_entries(id) on delete cascade,
  author_id  uuid not null references profiles(id) on delete cascade,
  reaction   text not null check (reaction in ('thumbs_up', 'heart')),
  created_at timestamptz not null default now(),
  unique (entry_id, author_id, reaction)
);

create index if not exists log_entry_reactions_entry
  on log_entry_reactions (entry_id);

alter table log_entry_reactions enable row level security;

drop policy if exists "can view reactions on visible entries" on log_entry_reactions;
drop policy if exists "can react to visible entries"           on log_entry_reactions;
drop policy if exists "can remove own reactions"                on log_entry_reactions;

create policy "can view reactions on visible entries"
  on log_entry_reactions for select
  using (public.can_view_log_entry(entry_id));

create policy "can react to visible entries"
  on log_entry_reactions for insert
  with check (
    author_id = auth.uid()
    and public.can_view_log_entry(entry_id)
  );

create policy "can remove own reactions"
  on log_entry_reactions for delete
  using (author_id = auth.uid());
