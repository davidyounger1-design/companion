-- ─────────────────────────────────────────────────────────────
-- 001 · Organisations & Profiles
-- Run against: Supabase project (Sydney region ap-southeast-2)
-- ─────────────────────────────────────────────────────────────

create table if not exists organisations (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,
  abn                        text,
  ndis_reg                   text,
  state                      text,
  services                   text[]  default '{}',
  myappbuddy_subscription_id text,
  myappbuddy_account_id      text,
  plan                       text    not null default 'trial',
  billing_status             text    not null default 'trial'
                               check (billing_status in ('trial','active','past_due','cancelled')),
  created_at                 timestamptz not null default now()
);

create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  role       text not null
               check (role in ('coordinator','support_worker','family','therapist')),
  org_id     uuid references organisations(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists org_settings (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null unique references organisations(id) on delete cascade,
  theme                 jsonb not null default '{}',
  digest_send_time      time  not null default '07:00',
  locale                text  not null default 'en-AU',
  feature_flags         jsonb not null default '{}',
  retention_preferences jsonb not null default '{}',
  created_at            timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────

alter table organisations enable row level security;
alter table profiles       enable row level security;
alter table org_settings   enable row level security;

-- Organisations: only org members can see their org
create policy "org members can view their org"
  on organisations for select
  using (
    id in (select org_id from profiles where id = auth.uid() and org_id is not null)
  );

create policy "org members can insert (during signup via app)"
  on organisations for insert
  with check (true);   -- app inserts, then immediately sets profile.org_id

create policy "coordinators can update their org"
  on organisations for update
  using (
    id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
  );

-- Profiles: users can see all profiles in their own org, plus their own
create policy "view own profile"
  on profiles for select
  using (id = auth.uid());

create policy "org members can view each other"
  on profiles for select
  using (
    org_id is not null and
    org_id in (select org_id from profiles where id = auth.uid() and org_id is not null)
  );

create policy "users can insert their own profile"
  on profiles for insert
  with check (id = auth.uid());

create policy "users can update their own profile"
  on profiles for update
  using (id = auth.uid());

-- Org settings: org members can read; coordinators can write
create policy "org members can view settings"
  on org_settings for select
  using (
    org_id in (select org_id from profiles where id = auth.uid() and org_id is not null)
  );

create policy "coordinators can manage settings"
  on org_settings for all
  using (
    org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
  );
