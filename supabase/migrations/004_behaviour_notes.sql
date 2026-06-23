-- ─────────────────────────────────────────────────────────────
-- 004 · Behaviour notes, note_shares, access_log
-- This is the consent heart of the product.
-- ─────────────────────────────────────────────────────────────

create table if not exists behaviour_notes (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references clients(id)       on delete cascade,
  org_id             uuid not null references organisations(id) on delete cascade,
  author_id          uuid not null references profiles(id)      on delete restrict,
  title              text not null,
  mood_before        smallint check (mood_before between 1 and 5),
  mood_after         smallint check (mood_after  between 1 and 5),
  antecedent         text,   -- A: what happened before
  behaviour          text,   -- B: the behaviour observed
  response           text,   -- C: how it was responded to
  flagged_for_review boolean not null default false,
  occurred_at        timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

-- THE consent record: a note is visible to a therapist iff a live row exists here
create table if not exists note_shares (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references behaviour_notes(id) on delete cascade,
  therapist_id uuid not null references profiles(id)        on delete cascade,
  shared_by    uuid not null references profiles(id)        on delete restrict,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (note_id, therapist_id)
);

-- Audit trail: insert-only
create table if not exists access_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid not null references profiles(id)        on delete restrict,
  note_id    uuid not null references behaviour_notes(id) on delete cascade,
  action     text not null check (action in ('view','share','revoke')),
  created_at timestamptz not null default now()
);

create index behaviour_notes_client on behaviour_notes (client_id, occurred_at desc);
create index note_shares_therapist  on note_shares (therapist_id) where revoked_at is null;
create index note_shares_note       on note_shares (note_id)      where revoked_at is null;

-- ── RLS ──────────────────────────────────────────────────────

alter table behaviour_notes enable row level security;
alter table note_shares     enable row level security;
alter table access_log      enable row level security;

-- behaviour_notes: workers can write for assigned clients
create policy "workers can create behaviour notes"
  on behaviour_notes for insert
  with check (
    author_id = auth.uid() and
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

-- behaviour_notes: workers can view notes for assigned clients
create policy "workers can view behaviour notes"
  on behaviour_notes for select
  using (
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

-- behaviour_notes: workers can flag for review (not full update)
create policy "workers can flag notes"
  on behaviour_notes for update
  using (
    client_id in (select client_id from client_workers where worker_id = auth.uid())
  )
  with check (
    -- only flagged_for_review may change; title/content must stay unchanged
    author_id = (select author_id from behaviour_notes where id = behaviour_notes.id)
  );

-- behaviour_notes: coordinators can view all in their org
create policy "coordinators can view behaviour notes"
  on behaviour_notes for select
  using (
    org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
  );

-- behaviour_notes: decision-maker can view their person's notes
create policy "decision_maker can view behaviour notes"
  on behaviour_notes for select
  using (
    client_id in (select id from clients where decision_maker_id = auth.uid())
    or
    client_id in (select client_id from client_family where family_id = auth.uid() and status = 'active')
  );

-- CRITICAL: therapists can ONLY see notes with a live note_shares row
create policy "therapists see only explicitly shared notes"
  on behaviour_notes for select
  using (
    id in (
      select note_id from note_shares
      where therapist_id = auth.uid() and revoked_at is null
    )
  );

-- note_shares: ONLY the decision-maker may insert/revoke
create policy "decision_maker can share notes"
  on note_shares for insert
  with check (
    shared_by = auth.uid() and
    note_id in (
      select bn.id from behaviour_notes bn
      join clients c on c.id = bn.client_id
      where c.decision_maker_id = auth.uid()
    )
  );

create policy "decision_maker can revoke note shares"
  on note_shares for update
  using (
    note_id in (
      select bn.id from behaviour_notes bn
      join clients c on c.id = bn.client_id
      where c.decision_maker_id = auth.uid()
    )
  );

-- therapists can view their own shares
create policy "therapists can view their shares"
  on note_shares for select
  using (therapist_id = auth.uid());

-- decision-maker can view shares for their person
create policy "decision_maker can view note shares"
  on note_shares for select
  using (
    note_id in (
      select bn.id from behaviour_notes bn
      join clients c on c.id = bn.client_id
      where c.decision_maker_id = auth.uid()
    )
  );

-- coordinators can view note_shares in their org
create policy "coordinators can view note_shares"
  on note_shares for select
  using (
    note_id in (
      select id from behaviour_notes
      where org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
    )
  );

-- access_log: authenticated users can insert for themselves
create policy "users can log access"
  on access_log for insert
  with check (actor_id = auth.uid());

-- access_log: decision-maker + coordinator can read
create policy "decision_maker and coordinator can view access log"
  on access_log for select
  using (
    actor_id = auth.uid()
    or note_id in (
      select bn.id from behaviour_notes bn
      join clients c on c.id = bn.client_id
      where c.decision_maker_id = auth.uid()
        or c.org_id in (select org_id from profiles where id = auth.uid() and role = 'coordinator')
    )
  );
