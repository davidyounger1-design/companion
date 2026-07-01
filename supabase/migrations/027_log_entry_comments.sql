-- ─────────────────────────────────────────────────────────────
-- 027 · Log entry comments   (idempotent)
--
-- Anyone who can currently see a log entry (per the existing
-- log_entries SELECT policies) can also comment on it. Rather than
-- duplicate those visibility rules across two tables and risk them
-- drifting apart, can_view_log_entry() mirrors them in one place —
-- update it if log_entries visibility ever changes.
-- ─────────────────────────────────────────────────────────────

create table if not exists log_entry_comments (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references log_entries(id) on delete cascade,
  client_id  uuid not null references clients(id) on delete cascade,
  org_id     uuid not null references organisations(id) on delete cascade,
  author_id  uuid not null references profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists log_entry_comments_entry_created
  on log_entry_comments (entry_id, created_at);

create or replace function public.can_view_log_entry(p_entry_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from log_entries le
    where le.id = p_entry_id
      and (
        (public.my_role() in ('support_worker', 'trusted_support_worker') and le.author_id = auth.uid())
        or (le.org_id = public.my_org_id() and public.my_role() = 'coordinator')
        or (le.client_id in (select public.client_ids_for_family()))
      )
  )
$$;

grant execute on function public.can_view_log_entry(uuid) to authenticated;

alter table log_entry_comments enable row level security;

drop policy if exists "can view comments on visible entries" on log_entry_comments;
drop policy if exists "can comment on visible entries"       on log_entry_comments;

create policy "can view comments on visible entries"
  on log_entry_comments for select
  using (public.can_view_log_entry(entry_id));

create policy "can comment on visible entries"
  on log_entry_comments for insert
  with check (
    author_id = auth.uid()
    and public.can_view_log_entry(entry_id)
  );
