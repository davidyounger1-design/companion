-- ─────────────────────────────────────────────────────────────
-- 054 · NDIS records — participant goals & goal-linked progress (idempotent)
-- Distinct from ndis_exports (the CSV export button) and from
-- behaviour_notes (day-to-day journal-style observations): a structured,
-- goal-aligned record — the participant's NDIS-plan goals, and progress
-- logged against each one over time. Gated by the ndis_records MAB
-- entitlement — this migration only creates the storage + access rules.
-- ─────────────────────────────────────────────────────────────

create table if not exists participant_goals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organisations(id) on delete cascade,
  client_id    uuid not null references clients(id)       on delete cascade,
  title        text not null,
  description  text,
  target_date  date,
  status       text not null default 'active' check (status in ('active','achieved','discontinued')),
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists goal_progress_records (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references participant_goals(id) on delete cascade,
  client_id   uuid not null references clients(id)           on delete cascade,
  org_id      uuid not null references organisations(id)     on delete cascade,
  author_id   uuid not null references profiles(id)          on delete restrict,
  occurred_at timestamptz not null default now(),
  rating      text not null check (rating in ('regressed','no_change','some_progress','good_progress','achieved')),
  notes       text not null,
  created_at  timestamptz not null default now()
);

create index if not exists participant_goals_client on participant_goals (client_id) where status = 'active';
create index if not exists goal_progress_goal        on goal_progress_records (goal_id, occurred_at desc);

alter table participant_goals     enable row level security;
alter table goal_progress_records enable row level security;

-- participant_goals: coordinators set goals; workers/decision-maker view them.
drop policy if exists "coordinators can manage goals" on participant_goals;
drop policy if exists "workers can view goals"        on participant_goals;
drop policy if exists "decision_maker can view goals" on participant_goals;

create policy "coordinators can manage goals"
  on participant_goals for all
  using (
    org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "workers can view goals"
  on participant_goals for select
  using (
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

create policy "decision_maker can view goals"
  on participant_goals for select
  using (
    client_id in (select id from clients where decision_maker_id = auth.uid())
  );

-- goal_progress_records: workers log progress for assigned clients;
-- coordinators manage all records in their org; decision-maker can view.
drop policy if exists "workers can log progress"           on goal_progress_records;
drop policy if exists "workers can view progress"          on goal_progress_records;
drop policy if exists "coordinators can manage progress"   on goal_progress_records;
drop policy if exists "decision_maker can view progress"   on goal_progress_records;

create policy "workers can log progress"
  on goal_progress_records for insert
  with check (
    author_id = auth.uid() and
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

create policy "workers can view progress"
  on goal_progress_records for select
  using (
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

create policy "coordinators can manage progress"
  on goal_progress_records for all
  using (
    org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "decision_maker can view progress"
  on goal_progress_records for select
  using (
    client_id in (select id from clients where decision_maker_id = auth.uid())
  );
