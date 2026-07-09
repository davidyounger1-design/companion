-- ─────────────────────────────────────────────────────────────
-- 053 · Incidents — structured incident reporting & escalation (idempotent)
-- Distinct from behaviour_notes: a formal record of something going wrong
-- (injury, restraint, medication error, near-miss, complaint) with a
-- severity rating and a status lifecycle a coordinator can escalate/resolve.
-- Gated by the incident_workflows MAB entitlement — this migration only
-- creates the storage + access rules.
-- ─────────────────────────────────────────────────────────────

create table if not exists incidents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organisations(id) on delete cascade,
  client_id         uuid not null references clients(id)       on delete cascade,
  author_id         uuid not null references profiles(id)      on delete restrict,
  occurred_at       timestamptz not null default now(),
  severity          text not null check (severity in ('low','medium','high','critical')),
  category          text not null check (category in ('injury','behaviour','medication','property','near_miss','complaint','other')),
  description       text not null,
  immediate_action  text,
  status            text not null default 'open' check (status in ('open','escalated','resolved')),
  escalated_at      timestamptz,
  escalated_by      uuid references profiles(id) on delete set null,
  resolved_at       timestamptz,
  resolved_by       uuid references profiles(id) on delete set null,
  resolution_notes  text,
  created_at        timestamptz not null default now()
);

create index if not exists incidents_client on incidents (client_id, occurred_at desc);
create index if not exists incidents_org_open on incidents (org_id) where status in ('open','escalated');

alter table incidents enable row level security;

drop policy if exists "workers can create incidents"           on incidents;
drop policy if exists "workers can view incidents"              on incidents;
drop policy if exists "coordinators can manage incidents"       on incidents;
drop policy if exists "decision_maker can view incidents"       on incidents;

create policy "workers can create incidents"
  on incidents for insert
  with check (
    author_id = auth.uid() and
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

-- Any worker assigned to the client can see its incidents — a shared safety
-- record for whoever is caring for that participant, not just the author.
create policy "workers can view incidents"
  on incidents for select
  using (
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

create policy "coordinators can manage incidents"
  on incidents for all
  using (
    org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "decision_maker can view incidents"
  on incidents for select
  using (
    client_id in (select id from clients where decision_maker_id = auth.uid())
  );
