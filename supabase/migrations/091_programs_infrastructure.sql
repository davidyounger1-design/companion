-- 091_programs_infrastructure.sql — programs, program_participants, program_workers
--
-- Foundation for Rostering (docs/superpowers/specs/2026-08-24-rostering-design.md),
-- itself designed in docs/superpowers/specs/2026-08-24-programs-design.md §3/§4/§5/§7
-- (that document's own numbers, 073/074, are STALE — it predates this session's
-- renumbering decision. This file and 092 are the authoritative 091/092.)
--
-- A provider org (day program, group home, in-home, community access) runs
-- multiple programs, each with its own participants and worker team. Today a
-- worker's access to a participant is a single flat client_workers join, with
-- no way to express "this worker only sees participants in the program they
-- staff." This migration adds that as a second, parallel access path.
--
-- Additive-first, zero behaviour change on deploy for every existing org: the
-- union added to client_ids_for_worker() (§4 below) returns nothing until
-- program_workers/program_participants have rows — no current org has either.
--
-- Deliberately NOT in this migration (see rostering-worklog.md "Locked
-- decisions" / programs-design.md §2 point 6, §9): the `programs` MAB
-- entitlement key and gate, and any Programs management UI (create/edit
-- program, assignment screens, dashboard filter, roster tags). This is the
-- headless prerequisite Rostering's schema depends on, not a shipped product
-- surface yet — David still needs to decide when the Programs UI itself is
-- built, and create the `programs` key in MAB Admin at that time (the
-- `rostering` key, which IS gated in this build, is a separate key — see 095).

begin;

-- ── 1 · clients(id, org_id) unique — prerequisite for program_participants' composite FK ──
-- Verified: clients (002_clients_workers.sql) has only `id uuid primary key`,
-- no existing (id, org_id) unique to reuse. Additive, no behaviour change.
alter table companion.clients
  drop constraint if exists clients_id_org_uk;
alter table companion.clients
  add constraint clients_id_org_uk unique (id, org_id);

-- ── 2 · programs ────────────────────────────────────────────────────
create table if not exists companion.programs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references companion.organisations(id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('day_program','group_home','in_home','community_access','other')),
  colour      text,               -- hex, for the UI's colour-coded chips/tags (future Programs UI)
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint programs_id_org_uk unique (id, org_id)   -- makes the composite FKs below possible
);

create index if not exists programs_org_idx on companion.programs(org_id);

alter table companion.programs enable row level security;

-- Select-only RLS — matches Rostering's own convention (§4 of that spec):
-- every write goes through the SECURITY DEFINER RPCs in 092, never direct
-- INSERT/UPDATE/DELETE. No entitlement gate here — deliberate, see header.
drop policy if exists "org members view programs" on companion.programs;
create policy "org members view programs"
  on companion.programs for select
  using (org_id = public.my_org_id());

revoke insert, update, delete on companion.programs from anon, authenticated;
grant select on companion.programs to authenticated;

-- ── 3 · program_participants ─────────────────────────────────────────
create table if not exists companion.program_participants (
  program_id     uuid not null,
  participant_id uuid not null,
  org_id         uuid not null,      -- composite FKs make cross-org rows structurally unexpressable
  joined_at      timestamptz not null default now(),
  left_at        timestamptz,        -- soft-delete: leaving one program must not affect others
  primary key (program_id, participant_id),
  foreign key (program_id, org_id)     references companion.programs(id, org_id) on delete cascade,
  foreign key (participant_id, org_id) references companion.clients(id, org_id)  on delete cascade
);

create index if not exists program_participants_program_idx on companion.program_participants(program_id);
create index if not exists program_participants_org_idx     on companion.program_participants(org_id);

alter table companion.program_participants enable row level security;

drop policy if exists "org members view program participants" on companion.program_participants;
create policy "org members view program participants"
  on companion.program_participants for select
  using (org_id = public.my_org_id());

revoke insert, update, delete on companion.program_participants from anon, authenticated;
grant select on companion.program_participants to authenticated;

-- ── 4 · program_workers ──────────────────────────────────────────────
create table if not exists companion.program_workers (
  program_id  uuid not null,
  worker_id   uuid not null,
  org_id      uuid not null,
  assigned_at timestamptz not null default now(),
  removed_at  timestamptz,
  primary key (program_id, worker_id),
  foreign key (program_id, org_id) references companion.programs(id, org_id) on delete cascade
  -- worker_id -> profiles(id) is a plain FK (profiles has no (id, org_id) unique
  -- key yet); org match is enforced in the assignment RPC (092), same pattern
  -- sub_roles' RPCs (068) already use. Residual risk, not new here.
);

create index if not exists program_workers_program_idx on companion.program_workers(program_id);
create index if not exists program_workers_worker_idx  on companion.program_workers(worker_id);
create index if not exists program_workers_org_idx     on companion.program_workers(org_id);

alter table companion.program_workers enable row level security;

drop policy if exists "org members view program workers" on companion.program_workers;
create policy "org members view program workers"
  on companion.program_workers for select
  using (org_id = public.my_org_id());

revoke insert, update, delete on companion.program_workers from anon, authenticated;
grant select on companion.program_workers to authenticated;

-- ── 5 · client_ids_for_worker() — program-derived access, unioned in ────
-- ⚠ Reconcile against `pg_get_functiondef('public.client_ids_for_worker'::regprocedure)`
-- immediately before running this — this body is reconciled against the last
-- migration-file redefinition (069_sub_role_write_paths.sql:425-433), not a
-- live `pg_get_functiondef` call (no live DB connection available while
-- writing this migration). The programs-design spec's own first draft of this
-- exact union omitted the org test on both branches, which would have
-- reverted 069's cross-tenant fix the moment it was pasted — do not skip this
-- check on the assumption "it's just adding a union".
create or replace function public.client_ids_for_worker()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  -- Direct assignment (069's body, unchanged). The clients join + org test is
  -- NOT decoration: it is 069's cross-tenant fix — a removed worker whose
  -- profile was detached retained read access to their old org's participants
  -- because client_workers rows survive detachment. Removing it silently
  -- reintroduces that hole.
  select cw.client_id
  from   companion.client_workers cw
  join   companion.clients c on c.id = cw.client_id
  where  cw.worker_id = auth.uid()
    and  c.org_id = public.my_org_id()
  union
  -- Program-derived (new). Same org test, for the same reason: program_workers
  -- rows also survive profile detachment, and my_org_id() is NULL for a
  -- detached profile, so this correctly denies rather than leaking.
  select pp.participant_id
  from   companion.program_workers pw
  join   companion.program_participants pp on pp.program_id = pw.program_id
  where  pw.worker_id = auth.uid()
    and  pw.removed_at is null
    and  pp.left_at  is null
    and  pw.org_id = public.my_org_id()
$$;

-- No-op on deploy: the new union branch returns nothing until program_workers/
-- program_participants have rows, so every existing org's resolved access is
-- bit-identical before and after this migration.

-- ── 6 · program_id on records (nullable, additive) ──────────────────
alter table companion.log_entries     add column if not exists program_id uuid references companion.programs(id) on delete set null;
alter table companion.behaviour_notes add column if not exists program_id uuid references companion.programs(id) on delete set null;
alter table companion.incidents       add column if not exists program_id uuid references companion.programs(id) on delete set null;

create index if not exists log_entries_program_idx     on companion.log_entries(program_id)     where program_id is not null;
create index if not exists behaviour_notes_program_idx on companion.behaviour_notes(program_id) where program_id is not null;
create index if not exists incidents_program_idx       on companion.incidents(program_id)       where program_id is not null;

commit;

-- ═══ POST-MIGRATION ASSERTIONS · all must return zero rows ═════════

-- A. Zero new tables missing RLS.
select c.relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'companion' and c.relname in ('programs','program_participants','program_workers')
  and not c.relrowsecurity;

-- B. Zero non-SELECT grants to anon/authenticated on any new table.
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'companion' and table_name in ('programs','program_participants','program_workers')
  and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';

-- C. For a worker with zero client_workers rows and zero program_workers rows,
--    client_ids_for_worker() returns an empty set (run as that worker, or via
--    `set local role` in a test harness — confirms the union adds reachable
--    participants, never grants blanket access as a side effect of a null join).

-- D. client_ids_for_family() / client_ids_for_recipient() / the therapist
--    client_circle path are untouched by this migration — direct diff their
--    function bodies before/after, don't infer from omission (programs-design
--    spec §8 item 5).
