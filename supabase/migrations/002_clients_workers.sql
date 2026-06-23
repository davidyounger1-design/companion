-- ─────────────────────────────────────────────────────────────
-- 002 · Clients, client_workers, client_family, client_circle  (idempotent)
-- ─────────────────────────────────────────────────────────────

create table if not exists clients (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references organisations(id) on delete cascade,
  full_name            text not null,
  setting              text,
  dob                  date,
  about                jsonb not null default '{}',
  decision_maker_id    uuid references profiles(id) on delete set null,
  decision_maker_kind  text check (decision_maker_kind in ('self','guardian','nominee')),
  goals                jsonb not null default '[]',
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

create table if not exists client_workers (
  client_id  uuid not null references clients(id)  on delete cascade,
  worker_id  uuid not null references profiles(id) on delete cascade,
  primary key (client_id, worker_id)
);

create table if not exists client_family (
  client_id    uuid not null references clients(id)  on delete cascade,
  family_id    uuid not null references profiles(id) on delete cascade,
  relationship text,
  status       text not null default 'invited'
                 check (status in ('invited','active')),
  primary key (client_id, family_id)
);

create table if not exists client_circle (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients(id)  on delete cascade,
  therapist_id uuid not null references profiles(id) on delete cascade,
  status       text not null default 'proposed'
                 check (status in ('proposed','pending_approval','in_circle','removed')),
  proposed_by  uuid references profiles(id),
  approved_by  uuid references profiles(id),
  created_at   timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────

alter table clients        enable row level security;
alter table client_workers enable row level security;
alter table client_family  enable row level security;
alter table client_circle  enable row level security;

-- clients
drop policy if exists "coordinators can manage clients"       on clients;
drop policy if exists "workers can view assigned clients"     on clients;
drop policy if exists "family can view their clients"         on clients;
drop policy if exists "therapists can view circle clients"    on clients;

create policy "coordinators can manage clients"
  on clients for all
  using (
    org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "workers can view assigned clients"
  on clients for select
  using (
    id in (select client_id from client_workers where worker_id = auth.uid())
  );

create policy "family can view their clients"
  on clients for select
  using (
    id in (select client_id from client_family where family_id = auth.uid() and status = 'active')
  );

create policy "therapists can view circle clients"
  on clients for select
  using (
    id in (select client_id from client_circle where therapist_id = auth.uid() and status = 'in_circle')
  );

-- client_workers
drop policy if exists "coordinators can manage client_workers" on client_workers;
drop policy if exists "workers can view their own assignments"  on client_workers;

create policy "coordinators can manage client_workers"
  on client_workers for all
  using (
    client_id in (
      select id from clients
      where org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
    )
  );

create policy "workers can view their own assignments"
  on client_workers for select
  using (worker_id = auth.uid());

-- client_family
drop policy if exists "coordinators can manage client_family" on client_family;
drop policy if exists "family can view their own links"        on client_family;

create policy "coordinators can manage client_family"
  on client_family for all
  using (
    client_id in (
      select id from clients
      where org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
    )
  );

create policy "family can view their own links"
  on client_family for select
  using (family_id = auth.uid());

-- client_circle
drop policy if exists "coordinators can manage circle"          on client_circle;
drop policy if exists "decision_maker can manage circle"        on client_circle;
drop policy if exists "therapists can view their circle status" on client_circle;

create policy "coordinators can manage circle"
  on client_circle for all
  using (
    client_id in (
      select id from clients
      where org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
    )
  );

create policy "decision_maker can manage circle"
  on client_circle for all
  using (
    client_id in (select id from clients where decision_maker_id = auth.uid())
  );

create policy "therapists can view their circle status"
  on client_circle for select
  using (therapist_id = auth.uid());
