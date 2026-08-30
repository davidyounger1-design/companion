-- ═══════════════════════════════════════════════════════════════════
-- 077 · Identity & access model, Step 1 + 1a — split persons off
--       clients, additive only (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-24-identity-access-
-- model-design.md §2.1, §2.1.2, §5 steps 1/1a. Read that before
-- touching anything here.
--
-- WHAT THIS DOES: creates companion.persons (identity: name, dob,
-- about, recipient login) and companion.clients.person_id, backfills
-- one persons row per EXISTING clients row (COPIED, not moved — the
-- old columns on clients are untouched), and adds the companion.
-- participants view that presents the joined shape existing reads
-- already expect.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: nothing reads companion.persons
-- or companion.participants yet (no frontend change in this pass), and
-- clients.full_name/dob/about/recipient_profile_id are NOT dropped —
-- both copies exist and agree. Zero behaviour change, by design (§5:
-- "additive first, cut over last, and at no point is the app broken
-- mid-sequence"). Dropping the old columns is step 1b, a separate,
-- deliberately harder migration that requires grepping every reader
-- first — not done here.
--
-- Six live clients rows today (checked 2026-08-24): "fred" ×2 (in two
-- different orgs, unrelated people, same name), Sarah Younger, mary,
-- another "fred" — this backfill gives each its own persons row.
-- Nothing here links any of them to each other; that's step 6
-- (person_link_codes / person_links), not yet written.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. Confirms the assumptions above. ═════

-- I1 · Every clients row today, with the columns this migration reads.
select id, org_id, full_name, dob, about, recipient_profile_id
from   companion.clients order by org_id, full_name;

-- I2 · clients' existing SELECT policies, mirrored onto persons below —
--      confirm no policy is missing from the mirror before running.
select pol.polname, pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) as using_expr
from   pg_policy pol join pg_class c on c.oid = pol.polrelid
where  c.relname = 'clients' and c.relnamespace = 'companion'::regnamespace
order  by pol.polcmd, pol.polname;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

create table if not exists companion.persons (
  id                   uuid primary key default gen_random_uuid(),
  full_name            text not null,
  dob                  date,
  about                jsonb not null default '{}',
  recipient_profile_id uuid references companion.profiles(id) on delete set null,
  created_at           timestamptz not null default now()
);

alter table companion.clients add column if not exists person_id uuid;

-- Backfill: one persons row per existing clients row, values COPIED
-- (clients keeps its own full_name/dob/about/recipient_profile_id —
-- this is not a move). A per-row loop, not an INSERT...SELECT paired
-- back via row_number() — Postgres gives no guarantee that insertion
-- order matches a separately-computed scan order, and two rows can
-- legitimately share every backfilled column (the two "fred" rows in
-- unrelated orgs, if their dob/about/recipient_profile_id also happen
-- to match) — a row_number() pairing could silently cross-wire them.
-- The loop captures each new person's id directly off its own INSERT,
-- so the client_id -> person_id correspondence can never be ambiguous.
-- Only rows not already backfilled, so re-running this file is safe.
do $$
declare
  c record;
  new_person_id uuid;
begin
  for c in select id, full_name, dob, about, recipient_profile_id
           from companion.clients where person_id is null
  loop
    insert into companion.persons (full_name, dob, about, recipient_profile_id)
    values (c.full_name, c.dob, c.about, c.recipient_profile_id)
    returning id into new_person_id;

    update companion.clients set person_id = new_person_id where id = c.id;
  end loop;
end $$;

alter table companion.clients alter column person_id set not null;
alter table companion.clients
  add constraint clients_person_id_fkey
  foreign key (person_id) references companion.persons(id);

-- ── RLS + grants ─────────────────────────────────────────────────────
alter table companion.persons enable row level security;
revoke all on table companion.persons from anon, authenticated;

-- Read-only mirror of clients' own SELECT policies (I2), joined through
-- person_id — a persons row is visible exactly when at least one of its
-- linked clients rows would be. Today that's always exactly one row, so
-- this is behaviourally identical to reading clients directly; once
-- linking exists (step 6) it becomes the actual merge. No INSERT/UPDATE/
-- DELETE grant yet — identity edits are step 2.1.1's RPC-gated write
-- path, not built in this migration.
grant select on companion.persons to authenticated;

drop policy if exists "persons visible via any linked enrolment" on companion.persons;
create policy "persons visible via any linked enrolment"
  on companion.persons for select
  using (
    exists (
      select 1 from companion.clients c
      where c.person_id = persons.id
        and (
          (c.org_id = public.my_org_id() and public.my_role() in ('coordinator', 'family'))
          or c.id in (select public.client_ids_for_family())
          or c.recipient_profile_id = auth.uid()
          or c.id in (select public.client_ids_for_therapist())
          or c.id in (select public.client_ids_for_worker())
        )
    )
  );

-- ── The view (§2.1.2) — nothing reads it yet, but shipped now so the
--    frontend cutover (a later step) has something to repoint at. ────
drop view if exists companion.participants;
create view companion.participants with (security_invoker = true) as
select c.id, c.org_id, c.person_id, c.setting, c.decision_maker_id, c.decision_maker_kind,
       c.active, c.created_at,
       p.full_name, p.dob, p.about, p.recipient_profile_id
from   companion.clients c join companion.persons p on p.id = c.person_id;

grant select on companion.participants to authenticated;

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · Every clients row has exactly one persons row, and no two share
--      one (the "no two share one" half matters once linking exists —
--      right now it should already hold trivially).
select person_id, count(*) from companion.clients group by person_id having count(*) > 1;
select count(*) as clients_missing_person from companion.clients where person_id is null;

-- V2 · Backfilled data matches the source exactly (spot-check all rows,
--      there are only a handful).
select c.id as client_id, c.full_name as client_name, p.full_name as person_name,
       c.dob as client_dob, p.dob as person_dob,
       c.about = p.about as about_matches,
       c.recipient_profile_id = p.recipient_profile_id or
         (c.recipient_profile_id is null and p.recipient_profile_id is null) as recipient_matches
from   companion.clients c join companion.persons p on p.id = c.person_id
order  by c.org_id, c.full_name;

-- V3 · participants view is security_invoker — the single most
--      dangerous mistake possible here (§7 item 0). Must show true.
select relname, reloptions from pg_class
where relname = 'participants' and relnamespace = 'companion'::regnamespace;

-- V4 · RLS enabled, no non-SELECT grant to anon/authenticated on persons.
select relname, relrowsecurity from pg_class
where relname = 'persons' and relnamespace = 'companion'::regnamespace;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'companion' and table_name = 'persons' and grantee in ('anon', 'authenticated');

-- ── Behavioural — run as a real signed-in user of each role, with
--    header Accept-Profile: companion / Content-Profile: companion.
-- V5 · A support worker queries companion.participants → sees exactly
--      the same rows they'd see querying companion.clients directly —
--      zero behaviour change is the whole point of this step.
-- V6 · A family member, a coordinator, a recipient, a therapist: same
--      check, same expected result (identical to today).
