-- 084_record_revisions.sql — audit trail for participant-record tables
--
-- Closes the live compliance gap (GAP-REPORT-HANDOFF §0/§2a): log_entries,
-- behaviour_notes, incidents and medication_logs could be edited with no
-- audit trail. A generic BEFORE UPDATE trigger snapshots the OLD row to
-- companion.record_revisions. Revisions are append-only for clients, only
-- ever soft-deleted, and retained ~7 years (never hard-deleted).
--
-- Pattern notes (recon-verified):
--   * SECURITY DEFINER + set search_path = 'companion','public' mirrors 082
--     so the trigger's own INSERT bypasses RLS on record_revisions (without
--     this every UPDATE on the four tables would fail).
--   * insert/update/delete are revoked from anon + authenticated because
--     060's schema default privileges would otherwise let any authenticated
--     client fabricate revision rows directly via PostgREST.
--   * The select policy uses companion.profile_orgs (left_at is null),
--     matching my_role()'s membership model in 079, so staff who belong to
--     several orgs see revisions for whichever org is currently active.
--   * edited_by is nullable: auth.uid() is null for service-role/backfill
--     updates — exactly the writes most worth auditing.

create table if not exists companion.record_revisions (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null
                check (table_name in ('log_entries','behaviour_notes','incidents','medication_logs','restrictive_practices','behaviour_support_plans')),
  record_id     uuid not null,
  previous_data jsonb not null,
  edited_by     uuid references companion.profiles(id),
  edited_at     timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists record_revisions_record_idx
  on companion.record_revisions (table_name, record_id);
create index if not exists record_revisions_edited_at_idx
  on companion.record_revisions (edited_at);
create index if not exists record_revisions_edited_by_idx
  on companion.record_revisions (edited_by);

alter table companion.record_revisions enable row level security;

drop policy if exists "revisions visible to org of editor" on companion.record_revisions;
create policy "revisions visible to org of editor"
  on companion.record_revisions
  for select
  using (
    exists (
      select 1 from companion.profile_orgs po
      where po.profile_id = record_revisions.edited_by
        and po.left_at is null
        and po.org_id = public.my_org_id()
    )
  );

-- The trigger is the only writer.
revoke insert, update, delete on table companion.record_revisions from anon, authenticated;
grant select on table companion.record_revisions to authenticated;

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
  insert into companion.record_revisions (table_name, record_id, previous_data, edited_by)
  values (tg_table_name, old.id, to_jsonb(old), auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_log_entries_revision on companion.log_entries;
create trigger trg_log_entries_revision
  before update on companion.log_entries
  for each row execute function companion.fn_record_revision();

drop trigger if exists trg_behaviour_notes_revision on companion.behaviour_notes;
create trigger trg_behaviour_notes_revision
  before update on companion.behaviour_notes
  for each row execute function companion.fn_record_revision();

drop trigger if exists trg_incidents_revision on companion.incidents;
create trigger trg_incidents_revision
  before update on companion.incidents
  for each row execute function companion.fn_record_revision();

drop trigger if exists trg_medication_logs_revision on companion.medication_logs;
create trigger trg_medication_logs_revision
  before update on companion.medication_logs
  for each row execute function companion.fn_record_revision();
