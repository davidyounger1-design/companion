-- ─────────────────────────────────────────────────────────────
-- 005 · Messages & Invites   (idempotent)
-- ─────────────────────────────────────────────────────────────

create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id)       on delete cascade,
  org_id     uuid not null references organisations(id) on delete cascade,
  sender_id  uuid not null references profiles(id)      on delete restrict,
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  email      text not null,
  role       text not null check (role in ('coordinator','support_worker','family','therapist')),
  client_id  uuid references clients(id) on delete cascade,
  token      text not null unique default encode(gen_random_bytes(24), 'hex'),
  status     text not null default 'pending'
               check (status in ('pending','accepted','expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index if not exists messages_client on messages (client_id, created_at desc);
create index if not exists invites_token   on invites (token) where status = 'pending';

-- ── RLS ──────────────────────────────────────────────────────

alter table messages enable row level security;
alter table invites  enable row level security;

drop policy if exists "org members can view messages" on messages;
drop policy if exists "org members can send messages" on messages;
drop policy if exists "coordinators can manage invites" on invites;

create policy "org members can view messages"
  on messages for select
  using (
    org_id in (
      select org_id from profiles where id = auth.uid()
        and role in ('coordinator','support_worker')
    )
    or client_id in (
      select client_id from client_family where family_id = auth.uid() and status = 'active'
    )
  );

create policy "org members can send messages"
  on messages for insert
  with check (
    sender_id = auth.uid() and
    org_id in (select org_id from profiles where id = auth.uid())
  );

create policy "coordinators can manage invites"
  on invites for all
  using (
    org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
  );
-- Invite token lookup is handled via a service-role Edge Function (no anon read here)
