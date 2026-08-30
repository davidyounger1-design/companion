-- ═══════════════════════════════════════════════════════════════════
-- 082 · URGENT FIX — clients.person_id NOT NULL broke every insert
--       path that doesn't set it (idempotent)
--
-- 077 added `clients.person_id uuid not null` for the identity model.
-- It did NOT audit every INSERT INTO clients call site — a mistake,
-- found only now while checking whether the linking UI's target
-- enrolment could even be created. Confirmed live 2026-08-25 via
-- pg_proc source search: TWO real paths insert into clients without
-- ever setting person_id, both currently broken in production —
--
--   companion.setup_family_org() — the RPC that runs on the FIRST step
--     of signing up for a family plan. Every new family-plan signup
--     has been failing since 077 landed.
--   src/pages/setup/Step4Clients.tsx — "add a participant" during
--     onboarding, a plain `.from('clients').insert({...})` with no
--     person_id.
--
-- (accept_invite() was also checked — it only ever UPDATEs an existing
-- client's recipient_profile_id, never inserts, so it was never at
-- risk.)
--
-- THE FIX: a BEFORE INSERT trigger, not touching either call site.
-- Postgres validates NOT NULL against the row's FINAL values, after
-- BEFORE triggers run — so a trigger that fills in person_id when the
-- caller left it null satisfies the constraint transparently, for
-- every insert path, including ones this migration didn't have to find
-- to fix. Explicitly passing a person_id (e.g. a future "create this
-- enrolment already linked to person X" flow) still works — the
-- trigger only acts when person_id is null.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · Every function that inserts into clients — confirms the two
--      known-broken paths and checks for a third nobody's found yet.
select proname from pg_proc
where prosrc ilike '%insert into%clients%' and pronamespace = 'companion'::regnamespace;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

create or replace function companion.auto_create_person_for_client()
returns trigger language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_person_id uuid;
begin
  if new.person_id is null then
    insert into companion.persons (full_name, dob, about, recipient_profile_id)
    values (new.full_name, new.dob, new.about, new.recipient_profile_id)
    returning id into v_person_id;
    new.person_id := v_person_id;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_auto_create_person on companion.clients;
create trigger clients_auto_create_person
  before insert on companion.clients
  for each row execute function companion.auto_create_person_for_client();

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · The trigger exists and fires BEFORE INSERT, per row.
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'companion.clients'::regclass and tgname = 'clients_auto_create_person';

-- V2 · The two known-broken paths now work — insert exactly as
--      Step4Clients.tsx does (no person_id given), confirm a persons
--      row was auto-created and matches, then clean up the test row.
do $$
declare
  v_test_org  uuid;
  v_client_id uuid;
  v_person_id uuid;
  v_ok        boolean;
begin
  select id into v_test_org from companion.organisations limit 1;

  insert into companion.clients (org_id, full_name, dob, active)
  values (v_test_org, '__082_test_row__', null, true)
  returning id, person_id into v_client_id, v_person_id;

  select (p.full_name = '__082_test_row__') into v_ok
  from companion.persons p where p.id = v_person_id;

  if v_person_id is null or not v_ok then
    raise exception 'V2 FAILED: trigger did not auto-create a matching persons row';
  end if;

  delete from companion.clients where id = v_client_id;
  delete from companion.persons where id = v_person_id;

  raise notice 'V2 PASSED: trigger correctly auto-created and matched a persons row, test row cleaned up';
end $$;
