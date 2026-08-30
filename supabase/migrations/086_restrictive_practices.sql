-- 086_restrictive_practices.sql — restrictive practices register
--
-- GAP-REPORT-HANDOFF §2b: a formal register of restrictive practices (RP)
-- per participant — type, whether authorised, the authorisation reference,
-- duration, notes — linked to a behaviour support plan once 087 exists (the
-- FK is added there; see the plan's ordering ruling). An unauthorised RP
-- automatically creates a companion.incidents row (after insert, best-effort:
-- a failure to create the incident never blocks the register write — the
-- register row itself is the compliance record).
--
-- Access mirrors 053_incidents.sql's policy shape: workers assigned to the
-- client can view, coordinators manage, decision makers view. Schema-
-- qualified throughout (060 moved the older tables into companion; 053's
-- unqualified policy bodies predate that).
--
-- Edits to register rows are audited by 084's fn_record_revision() trigger,
-- attached below (084's table_name check includes this table).

create table if not exists companion.restrictive_practices (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references companion.organisations(id) on delete cascade,
  client_id               uuid not null references companion.clients(id)       on delete cascade,
  recorded_by             uuid not null references companion.profiles(id)      on delete restrict,
  type                    text not null
                          check (type in ('chemical','environmental','mechanical','physical','seclusion')),
  authorised              boolean not null default false,
  authorisation_reference text,
  started_at              timestamptz not null default now(),
  ended_at                timestamptz,
  notes                   text,
  created_at              timestamptz not null default now()
);

create index if not exists restrictive_practices_client_idx
  on companion.restrictive_practices (client_id, started_at desc);
create index if not exists restrictive_practices_org_idx
  on companion.restrictive_practices (org_id);

alter table companion.restrictive_practices enable row level security;

drop policy if exists "workers can view restrictive practices"         on companion.restrictive_practices;
drop policy if exists "coordinators can manage restrictive practices"  on companion.restrictive_practices;
drop policy if exists "decision_maker can view restrictive practices"  on companion.restrictive_practices;

-- Any worker assigned to the client can see its register — a shared safety
-- record for whoever is caring for that participant (mirrors 053).
create policy "workers can view restrictive practices"
  on companion.restrictive_practices for select
  using (
    client_id in (select public.client_ids_for_worker())
  );

create policy "coordinators can manage restrictive practices"
  on companion.restrictive_practices for all
  using (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "decision_maker can view restrictive practices"
  on companion.restrictive_practices for select
  using (
    client_id in (select id from companion.clients where decision_maker_id = auth.uid())
  );

-- An unauthorised RP is itself a reportable incident: auto-create one.
-- The register row is authoritative, so an incident-creation failure must
-- never roll the register write back (exception swallowed deliberately).
create or replace function companion.fn_rp_unauthorised_incident()
returns trigger
language plpgsql
security definer
set search_path = 'companion', 'public'
as $$
begin
  if new.authorised is false then
    begin
      insert into companion.incidents (
        org_id, client_id, author_id, occurred_at, severity, category,
        description, status, created_at
      ) values (
        new.org_id,
        new.client_id,
        coalesce(auth.uid(), new.recorded_by),
        coalesce(new.started_at, now()),
        'high',
        'behaviour',
        'Unauthorised restrictive practice recorded: ' || new.type ||
          case when new.notes is not null and new.notes <> '' then ' — ' || new.notes else '' end,
        'open',
        now()
      );
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_rp_unauthorised_incident on companion.restrictive_practices;
create trigger trg_rp_unauthorised_incident
  after insert on companion.restrictive_practices
  for each row execute function companion.fn_rp_unauthorised_incident();

-- Audit trail (084): snapshot OLD rows on every edit.
drop trigger if exists trg_restrictive_practices_revision on companion.restrictive_practices;
create trigger trg_restrictive_practices_revision
  before update on companion.restrictive_practices
  for each row execute function companion.fn_record_revision();
