-- 088_export_log.sql — audit log for server-side exports
--
-- GAP-REPORT-HANDOFF §2d/§3: exports must be "access-controlled and
-- audit-logged", which requires a server-side writer. access_log is
-- hardwired to behaviour_notes (non-null note_id FK + 3-value action
-- check), so a sibling table is used for exports (plan provisional
-- decision 2 — do NOT widen access_log).
--
-- The export-records edge function (Task 5, authored separately) writes
-- one row per export request as service_role. Clients can only ever read
-- their own org's rows, and only coordinators — an audit trail is not for
-- the audited. 060's schema default privileges would let authenticated
-- clients fabricate rows via PostgREST, so insert/update/delete are
-- revoked exactly as 084 does for record_revisions (the trigger/service
-- function is the only writer).
--
-- client_id is nullable + SET NULL: an export of a participant later
-- deleted must not delete the audit row; the row survives with the
-- participant reference cleared.

create table if not exists companion.export_log (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references companion.organisations(id) on delete cascade,
  actor_id   uuid not null references companion.profiles(id)      on delete restrict,
  client_id  uuid references companion.clients(id)                on delete set null,
  kind       text not null
             check (kind in ('participant_record','goal_progress','medication_record',
                             'incident_register','restrictive_practices_register',
                             'claim_summary')),
  format     text not null check (format in ('csv','pdf')),
  created_at timestamptz not null default now()
);

create index if not exists export_log_org_idx
  on companion.export_log (org_id, created_at desc);
create index if not exists export_log_actor_idx
  on companion.export_log (actor_id);
create index if not exists export_log_client_idx
  on companion.export_log (client_id);

alter table companion.export_log enable row level security;

drop policy if exists "coordinators can view org export log" on companion.export_log;
create policy "coordinators can view org export log"
  on companion.export_log
  for select
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
  );

-- The edge function is the only writer.
revoke insert, update, delete on table companion.export_log from anon, authenticated;
grant select on table companion.export_log to authenticated;
