-- ─────────────────────────────────────────────────────────────
-- 003 · Log entries
-- ─────────────────────────────────────────────────────────────

create table if not exists log_entries (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id)       on delete cascade,
  org_id      uuid not null references organisations(id) on delete cascade,
  author_id   uuid not null references profiles(id)      on delete restrict,
  type        text not null
                check (type in ('meal','activity','mood','photo')),
  label       text not null,
  occurred_at timestamptz not null default now(),
  photo_path  text,
  created_at  timestamptz not null default now()
);

create index log_entries_client_occurred on log_entries (client_id, occurred_at desc);
create index log_entries_org_occurred    on log_entries (org_id, occurred_at desc);

-- ── RLS ──────────────────────────────────────────────────────

alter table log_entries enable row level security;

-- Workers insert only for their assigned clients
create policy "workers can log for assigned clients"
  on log_entries for insert
  with check (
    author_id = auth.uid() and
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

-- Workers can view their own entries + all entries for assigned clients
create policy "workers can view logs for assigned clients"
  on log_entries for select
  using (
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

-- Coordinators can view all entries in their org
create policy "coordinators can view org log entries"
  on log_entries for select
  using (
    org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
  );

-- Family can view entries for their linked clients
create policy "family can view log entries"
  on log_entries for select
  using (
    client_id in (select client_id from client_family where family_id = auth.uid() and status = 'active')
  );

-- Therapists cannot view log_entries — only shared behaviour_notes
