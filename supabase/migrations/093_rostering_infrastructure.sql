-- 093_rostering_infrastructure.sql — shifts, participants, handovers, templates,
-- availability, skills
--
-- Design: docs/superpowers/specs/2026-08-24-rostering-design.md §2/§4/§7
-- (finalized 2026-08-30). Depends on 091/092 (programs.id/org_id, program_workers).
--
-- Six new tables, all select-only RLS — every write goes through the
-- SECURITY DEFINER RPCs in 094, never direct INSERT/UPDATE/DELETE. Entitlement
-- gate (`rostering`, David creates this key in MAB Admin after this ships —
-- until then every org is refused, the fail-closed direction) on all six.

begin;

-- ── 1 · shift_templates (created before shifts — shifts.template_id FKs it) ──
create table if not exists companion.shift_templates (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references companion.organisations(id) on delete cascade,
  program_id      uuid not null,
  worker_id       uuid not null references companion.profiles(id) on delete restrict,  -- v1 lite: templates always coordinator-assigned, never open
  day_of_week     int not null check (day_of_week between 0 and 6),
  starts_time     time not null,
  ends_time       time not null check (ends_time > starts_time),
  end_date        date,                        -- null = generates indefinitely
  participant_ids uuid[] not null default '{}', -- carried onto each generated shift
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  foreign key (program_id, org_id) references companion.programs(id, org_id) on delete cascade
);

create index if not exists shift_templates_org_program_idx on companion.shift_templates(org_id, program_id);

-- ── 2 · shifts ────────────────────────────────────────────────────────
create table if not exists companion.shifts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references companion.organisations(id) on delete cascade,
  program_id      uuid not null,
  worker_id       uuid references companion.profiles(id) on delete restrict,  -- nullable: open (unassigned) shift, job board
  is_open         boolean not null default false,
  required_skills text[] not null default '{}',
  template_id     uuid references companion.shift_templates(id) on delete set null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null check (ends_at > starts_at),
  status          text not null default 'draft' check (status in ('draft','published','confirmed','in_progress','completed','cancelled')),
  notes           text,                -- coordinator note; cancellation reason lands here too
  override_note   text,                -- coordinator override for a worker-overlap warning
  created_by      uuid not null references companion.profiles(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  deleted_at      timestamptz,         -- soft-delete only; never hard-delete
  constraint shifts_id_org_uk unique (id, org_id),          -- enables shift_participants composite FK
  constraint shifts_open_worker_null check (not is_open or worker_id is null),
  foreign key (program_id, org_id) references companion.programs(id, org_id) on delete cascade
);

create unique index if not exists shifts_template_starts_uk on companion.shifts(template_id, starts_at) where template_id is not null;
create index if not exists shifts_org_program_starts_idx on companion.shifts(org_id, program_id, starts_at);
create index if not exists shifts_worker_starts_idx       on companion.shifts(worker_id, starts_at);
create index if not exists shifts_org_status_idx          on companion.shifts(org_id, status);
create index if not exists shifts_open_job_board_idx      on companion.shifts(org_id, is_open, status) where is_open;

-- ── 3 · shift_participants ───────────────────────────────────────────
create table if not exists companion.shift_participants (
  shift_id       uuid not null,
  participant_id uuid not null,
  org_id         uuid not null,      -- composite FKs make cross-org rows structurally unexpressable
  left_at        timestamptz,        -- soft-remove: participant removed from a shift keeps history
  primary key (shift_id, participant_id),
  foreign key (shift_id, org_id)       references companion.shifts(id, org_id)  on delete cascade,
  foreign key (participant_id, org_id) references companion.clients(id, org_id) on delete cascade
);

create index if not exists shift_participants_participant_idx on companion.shift_participants(participant_id);

-- ── 4 · shift_handovers ──────────────────────────────────────────────
create table if not exists companion.shift_handovers (
  id                   uuid primary key default gen_random_uuid(),
  shift_id             uuid not null references companion.shifts(id) on delete cascade,
  author_id            uuid not null references companion.profiles(id) on delete restrict,
  body                 text,                    -- nullable; see "nothing to hand over"
  nothing_to_hand_over boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint handover_body_xor check ((body is null or body = '') = nothing_to_hand_over)
  -- append-only: written once by rostering_end_shift (or coordinator force-end);
  -- no UPDATE/DELETE path ever exists — no revision trigger either (§7).
);

create index if not exists shift_handovers_shift_created_idx on companion.shift_handovers(shift_id, created_at desc);

-- ── 5 · worker_availability ───────────────────────────────────────────
create table if not exists companion.worker_availability (
  worker_id     uuid not null references companion.profiles(id) on delete cascade,
  org_id        uuid not null references companion.organisations(id) on delete cascade,
  day_of_week   int not null check (day_of_week between 0 and 6),
  starts_time   time not null,
  ends_time     time not null check (ends_time > starts_time),
  primary key (worker_id, day_of_week)         -- v1 lite: one window per weekday, not multiple ranges
);

create index if not exists worker_availability_org_idx on companion.worker_availability(org_id);

-- ── 6 · profile_skills ───────────────────────────────────────────────
create table if not exists companion.profile_skills (
  profile_id    uuid not null references companion.profiles(id) on delete cascade,
  org_id        uuid not null references companion.organisations(id) on delete cascade,
  skill         text not null,
  primary key (profile_id, skill)
);

create index if not exists profile_skills_org_skill_idx on companion.profile_skills(org_id, skill);

-- ── 7 · worker_program_ids() — the job-board / handover-scope predicate ──
-- companion schema (not public): only referenced from RLS policies below and
-- from 094's RPCs, all already inside the companion schema's search_path.
create or replace function companion.worker_program_ids()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select pw.program_id
  from   companion.program_workers pw
  where  pw.worker_id = auth.uid()
    and  pw.removed_at is null
    and  pw.org_id = public.my_org_id()
$$;

revoke execute on function companion.worker_program_ids() from public, anon;
grant  execute on function companion.worker_program_ids() to authenticated;

-- ── 8 · RLS ───────────────────────────────────────────────────────────
alter table companion.shift_templates    enable row level security;
alter table companion.shifts             enable row level security;
alter table companion.shift_participants enable row level security;
alter table companion.shift_handovers    enable row level security;
alter table companion.worker_availability enable row level security;
alter table companion.profile_skills     enable row level security;

drop policy if exists "coordinators view org shifts" on companion.shifts;
create policy "coordinators view org shifts"
  on companion.shifts for select
  using (org_id = public.my_org_id() and public.my_role() = 'coordinator' and deleted_at is null);

drop policy if exists "workers view own shifts" on companion.shifts;
create policy "workers view own shifts"
  on companion.shifts for select
  using (worker_id = auth.uid() and deleted_at is null and status in ('published','confirmed','in_progress','completed'));

drop policy if exists "workers view open shifts job board" on companion.shifts;
create policy "workers view open shifts job board"
  on companion.shifts for select
  using (is_open and status = 'published' and deleted_at is null
         and program_id in (select companion.worker_program_ids()));

drop policy if exists "coordinator view shift participants" on companion.shift_participants;
create policy "coordinator view shift participants"
  on companion.shift_participants for select
  using (org_id = public.my_org_id() and public.my_role() = 'coordinator');

drop policy if exists "worker view own shift participants" on companion.shift_participants;
create policy "worker view own shift participants"
  on companion.shift_participants for select
  using (
    left_at is null and exists (
      select 1 from companion.shifts s
      where s.id = shift_participants.shift_id
        and s.worker_id = auth.uid() and s.deleted_at is null
        and s.status in ('published','confirmed','in_progress','completed')
    )
  );

drop policy if exists "coordinator view shift handovers" on companion.shift_handovers;
create policy "coordinator view shift handovers"
  on companion.shift_handovers for select
  using (
    public.my_role() = 'coordinator'
    and shift_id in (select id from companion.shifts where org_id = public.my_org_id() and deleted_at is null)
  );

drop policy if exists "worker view program shift handovers" on companion.shift_handovers;
create policy "worker view program shift handovers"
  on companion.shift_handovers for select
  using (
    shift_id in (
      select id from companion.shifts
      where deleted_at is null
        and (worker_id = auth.uid() or program_id in (select companion.worker_program_ids()))
    )
  );

drop policy if exists "coordinator org view shift templates" on companion.shift_templates;
create policy "coordinator org view shift templates"
  on companion.shift_templates for select
  using (org_id = public.my_org_id() and public.my_role() = 'coordinator');
-- No worker read policy — workers never see templates directly, only the
-- shifts they generate.

drop policy if exists "worker own availability" on companion.worker_availability;
create policy "worker own availability"
  on companion.worker_availability for select
  using (worker_id = auth.uid());

drop policy if exists "coordinator org read availability" on companion.worker_availability;
create policy "coordinator org read availability"
  on companion.worker_availability for select
  using (org_id = public.my_org_id() and public.my_role() = 'coordinator');

drop policy if exists "worker own skills" on companion.profile_skills;
create policy "worker own skills"
  on companion.profile_skills for select
  using (profile_id = auth.uid());

drop policy if exists "coordinator org read skills" on companion.profile_skills;
create policy "coordinator org read skills"
  on companion.profile_skills for select
  using (org_id = public.my_org_id() and public.my_role() = 'coordinator');

-- Entitlement gate — restrictive, on all six tables. (select …) wrapping per
-- 076's pattern: a constant-argument expression the planner folds into a
-- once-per-statement InitPlan, not per-row.
drop policy if exists "entitlement gate: shifts" on companion.shifts;
create policy "entitlement gate: shifts"
  on companion.shifts as restrictive for all to authenticated
  using ((select public.org_has_feature('rostering')))
  with check ((select public.org_has_feature('rostering')));

drop policy if exists "entitlement gate: shift_participants" on companion.shift_participants;
create policy "entitlement gate: shift_participants"
  on companion.shift_participants as restrictive for all to authenticated
  using ((select public.org_has_feature('rostering')))
  with check ((select public.org_has_feature('rostering')));

drop policy if exists "entitlement gate: shift_handovers" on companion.shift_handovers;
create policy "entitlement gate: shift_handovers"
  on companion.shift_handovers as restrictive for all to authenticated
  using ((select public.org_has_feature('rostering')))
  with check ((select public.org_has_feature('rostering')));

drop policy if exists "entitlement gate: shift_templates" on companion.shift_templates;
create policy "entitlement gate: shift_templates"
  on companion.shift_templates as restrictive for all to authenticated
  using ((select public.org_has_feature('rostering')))
  with check ((select public.org_has_feature('rostering')));

drop policy if exists "entitlement gate: worker_availability" on companion.worker_availability;
create policy "entitlement gate: worker_availability"
  on companion.worker_availability as restrictive for all to authenticated
  using ((select public.org_has_feature('rostering')))
  with check ((select public.org_has_feature('rostering')));

drop policy if exists "entitlement gate: profile_skills" on companion.profile_skills;
create policy "entitlement gate: profile_skills"
  on companion.profile_skills as restrictive for all to authenticated
  using ((select public.org_has_feature('rostering')))
  with check ((select public.org_has_feature('rostering')));

-- ── 9 · revoke/grant — writes go through 094's RPCs only ─────────────
revoke insert, update, delete on companion.shifts             from anon, authenticated;
revoke insert, update, delete on companion.shift_participants  from anon, authenticated;
revoke insert, update, delete on companion.shift_handovers     from anon, authenticated;
revoke insert, update, delete on companion.shift_templates     from anon, authenticated;
revoke insert, update, delete on companion.worker_availability from anon, authenticated;
revoke insert, update, delete on companion.profile_skills      from anon, authenticated;

grant select on companion.shifts             to authenticated;
grant select on companion.shift_participants to authenticated;
grant select on companion.shift_handovers    to authenticated;
grant select on companion.shift_templates    to authenticated;
grant select on companion.worker_availability to authenticated;
grant select on companion.profile_skills     to authenticated;

-- ── 10 · record_revisions extensions (084) ───────────────────────────
-- (a) record_org_id fix, org-wide: 084's select policy resolves visibility
--     through the editor's CURRENT profile_orgs membership, so a departed
--     worker's revisions vanish from the org audit view. Adding a stamped
--     org_id at write time and OR-ing it into the select policy keeps
--     revisions visible to the org that owns the row regardless of who later
--     departs — independent of, and in addition to, the existing predicate.
alter table companion.record_revisions add column if not exists record_org_id uuid;

create or replace function companion.fn_record_revision()
returns trigger
language plpgsql
security definer
set search_path = 'companion', 'public'
as $$
begin
  if old is not distinct from new then
    return new; -- no-op update, nothing to record
  end if;
  insert into companion.record_revisions (table_name, record_id, previous_data, edited_by, record_org_id)
  values (tg_table_name, old.id, to_jsonb(old), auth.uid(), old.org_id);
  return new;
end;
$$;

drop policy if exists "revisions visible to org of editor" on companion.record_revisions;
create policy "revisions visible to org of editor"
  on companion.record_revisions
  for select
  using (
    record_org_id = public.my_org_id()
    or exists (
      select 1 from companion.profile_orgs po
      where po.profile_id = record_revisions.edited_by
        and po.left_at is null
        and po.org_id = public.my_org_id()
    )
  );

-- (b) table_name check extended for 'shifts'. Idempotent: default constraint
--     name for an inline column check is <table>_<column>_check.
alter table companion.record_revisions drop constraint if exists record_revisions_table_name_check;
alter table companion.record_revisions add constraint record_revisions_table_name_check
  check (table_name in ('log_entries','behaviour_notes','incidents','medication_logs',
                         'restrictive_practices','behaviour_support_plans','shifts'));

-- (c) revision trigger on shifts ONLY. shift_handovers is append-only (no
--     UPDATE path exists — a trigger there would be dead code); shift_templates/
--     worker_availability/profile_skills are config/settings tables, not care-
--     record history — no revision trigger on any of the three, stated
--     explicitly so a future migration doesn't "complete the set" by mistake.
drop trigger if exists trg_shifts_revision on companion.shifts;
create trigger trg_shifts_revision
  before update on companion.shifts
  for each row execute function companion.fn_record_revision();

-- ── 11 · shift_templates generation (pg_cron, 085's idempotent-schedule pattern) ──
-- Unlike 085 (which dispatches to an edge function via net.http_post), this
-- calls a local SECURITY DEFINER function directly — no HTTP round-trip, no
-- Vault secret needed.
create extension if not exists pg_cron;

create or replace function companion.fn_generate_shift_templates()
returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare t record; v_next_date date; v_starts_at timestamptz; v_ends_at timestamptz; v_shift_id uuid; p uuid;
begin
  for t in select * from companion.shift_templates
           where active and (end_date is null or end_date >= current_date)
  loop
    -- Next occurrence of t.day_of_week on/after today (0 = Sunday, matching extract(dow)).
    v_next_date := current_date + ((t.day_of_week - extract(dow from current_date)::int + 7) % 7);
    if t.end_date is not null and v_next_date > t.end_date then continue; end if;

    v_starts_at := v_next_date + t.starts_time;
    v_ends_at   := v_next_date + t.ends_time;

    insert into companion.shifts (org_id, program_id, worker_id, template_id, starts_at, ends_at, created_by)
    values (t.org_id, t.program_id, t.worker_id, t.id, v_starts_at, v_ends_at, t.worker_id)
    on conflict (template_id, starts_at) where template_id is not null do nothing
    returning id into v_shift_id;

    if v_shift_id is not null then
      foreach p in array t.participant_ids loop
        insert into companion.shift_participants (shift_id, participant_id, org_id)
        values (v_shift_id, p, t.org_id)
        on conflict (shift_id, participant_id) do nothing;
      end loop;
    end if;
  end loop;
end $$;

revoke execute on function companion.fn_generate_shift_templates() from public, anon, authenticated;
grant  execute on function companion.fn_generate_shift_templates() to postgres;

select cron.unschedule('companion_generate_shifts')
where exists (select 1 from cron.job where jobname = 'companion_generate_shifts');

select cron.schedule(
  'companion_generate_shifts',
  '5 0 * * *',  -- 00:05 UTC daily — one day ahead of the earliest possible shift start, generation is idempotent so re-runs are harmless
  $$select companion.fn_generate_shift_templates();$$
);

commit;

-- ═══ POST-MIGRATION ASSERTIONS · all must return zero rows ═════════

-- A. Zero new tables missing RLS.
select c.relname from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'companion'
  and c.relname in ('shifts','shift_participants','shift_handovers','shift_templates','worker_availability','profile_skills')
  and not c.relrowsecurity;

-- B. Zero non-SELECT grants to anon/authenticated on any new table.
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'companion'
  and table_name in ('shifts','shift_participants','shift_handovers','shift_templates','worker_availability','profile_skills')
  and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';

-- C. Every gate policy is RESTRICTIVE, not accidentally permissive.
select tablename, policyname, permissive from pg_policies
where schemaname = 'companion' and policyname like 'entitlement gate:%'
  and tablename in ('shifts','shift_participants','shift_handovers','shift_templates','worker_availability','profile_skills')
  and permissive <> 'RESTRICTIVE';

-- D. Exactly one gate policy per target table.
select tablename, count(*) from pg_policies
where schemaname = 'companion' and policyname like 'entitlement gate:%'
  and tablename in ('shifts','shift_participants','shift_handovers','shift_templates','worker_availability','profile_skills')
group by tablename having count(*) <> 1;

-- E. worker_program_ids() is SECURITY DEFINER with a pinned search_path.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'companion' and p.proname = 'worker_program_ids'
  and (not p.prosecdef or p.proconfig is null);

-- F. Retention: 085's cron touches log_entries only — confirm shift_handovers
--    and record_revisions have no purge mechanism (grep supabase/functions and
--    supabase/migrations for any DELETE against either table; expect none).
