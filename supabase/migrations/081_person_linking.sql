-- ═══════════════════════════════════════════════════════════════════
-- 081 · Identity & access model, Step 6 — linking two drawers safely
--       (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-24-identity-access-
-- model-design.md §4, §5 step 6. Read §4.1's seven rules before
-- touching anything here — this is "a different category of harm from
-- everything else" per the spec's own framing: a wrong link is
-- cross-household, not cross-organisation.
--
-- WHAT THIS DOES: person_link_codes + person_links (§4.2, unchanged
-- from the spec's DDL), and four RPCs — nothing else touches these
-- tables, by design (rule 1: no cross-tenant search, ever; the only
-- way to reach a code is to already hold it).
--
--   generate_person_link_code(client_id)      — source side, rule 3
--   preview_person_link(code, target_client_id) — read-only, rule 4
--   confirm_person_link(code, target_client_id) — commits, rules 4/7
--   unlink_person(client_id)                    — reversible, rule 6
--
-- Every RPC's FIRST check is companion.is_participant_or_decision_maker
-- — never a coordinator, never a worker (rule 3, both directions).
--
-- THE CHAINING GUARD (rule 7): confirm_person_link refuses if the
-- TARGET's current person already has more than one clients row — i.e.
-- the target is already itself a merged cabinet. Without this, linking
-- a fresh B (already merged with A) onto C would silently merge A and
-- C too, without either A's or C's household ever confirming a link
-- between them. The SOURCE side has no such restriction — adding a
-- third, fourth drawer to an already-linked cabinet is the intended
-- "add another drawer" case, not chaining, because every addition
-- shares the one unbroken person_id rather than joining two pre-
-- existing groups.
--
-- WHAT UNLINK DOES NOT DO: it does not delete the shared persons row
-- (other clients rows may still depend on it) and it does not delete
-- the unlinked client's former solo person if one still exists from
-- before an earlier link — there is no such row by the time unlink
-- runs, because linking never deleted it (see below). Unlinking gives
-- the drawer a FRESH persons row, snapshotting the shared identity data
-- as it stands right now, so the household keeps what it already knew
-- rather than starting from blank.
--
-- ORPHANED "SOLO" PERSONS ROWS: when confirm_person_link repoints a
-- target's person_id to the source's, the target's own original solo
-- persons row becomes unreferenced. It is DELIBERATELY NOT DELETED —
-- if a coordinator had already filled in `about` for that solo record
-- before realising it should be linked instead, deleting it would lose
-- that content with no recovery path. An orphaned row with nothing
-- pointing to it is harmless clutter, not a correctness or privacy
-- issue (it is still exactly as access-controlled as it was before —
-- 077's policy requires a linked clients row to see a persons row at
-- all, so an orphan is *less* visible than before, not more).
-- ═══════════════════════════════════════════════════════════════════


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

create table if not exists companion.person_link_codes (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique default encode(gen_random_bytes(24), 'hex'),
  source_client_id  uuid not null references companion.clients(id) on delete cascade,
  created_by        uuid not null references companion.profiles(id),
  expires_at        timestamptz not null,
  redeemed_at       timestamptz,
  redeemed_by       uuid references companion.profiles(id),
  target_client_id  uuid references companion.clients(id) on delete set null,
  created_at        timestamptz not null default now()
);

create table if not exists companion.person_links (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references companion.persons(id) on delete cascade,
  client_id      uuid not null references companion.clients(id) on delete cascade,
  linked_by      uuid references companion.profiles(id),
  linked_at      timestamptz not null default now(),
  unlinked_at    timestamptz,
  unlinked_by    uuid references companion.profiles(id),
  link_code_id   uuid references companion.person_link_codes(id)
);

-- No direct table grant at all, for either table — every read and
-- write goes through the RPCs below, which disclose only what §4.1
-- rule 4 allows and check authorisation on every call.
alter table companion.person_link_codes enable row level security;
alter table companion.person_links      enable row level security;
revoke all on table companion.person_link_codes, companion.person_links from anon, authenticated;

-- ── Shared authorisation check — rule 3, both directions ────────────
create or replace function companion.is_participant_or_decision_maker(p_client_id uuid)
returns boolean language sql stable security definer
set search_path = 'companion', 'public' as $$
  select exists (
    select 1 from companion.clients c
    join   companion.persons p on p.id = c.person_id
    where  c.id = p_client_id and p.recipient_profile_id = auth.uid()
  ) or exists (
    select 1 from companion.clients c
    where  c.id = p_client_id and c.decision_maker_id = auth.uid()
  )
$$;

-- ── 1. Generate a code from the SOURCE drawer (the one already known
--       to be genuinely this person) ───────────────────────────────
create or replace function public.generate_person_link_code(p_client_id uuid)
returns table (code text, expires_at timestamptz)
language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_row companion.person_link_codes;
begin
  if not companion.is_participant_or_decision_maker(p_client_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  insert into companion.person_link_codes (source_client_id, created_by, expires_at)
  values (p_client_id, auth.uid(), now() + interval '30 minutes')
  returning * into v_row;

  return query select v_row.code, v_row.expires_at;
end;
$$;

-- ── 2. Preview — read-only, discloses the minimum (rule 4) ─────────
create or replace function public.preview_person_link(p_code text, p_target_client_id uuid)
returns table (first_name text, last_initial text, dob date, source_org_name text)
language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_link companion.person_link_codes;
begin
  if not companion.is_participant_or_decision_maker(p_target_client_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_link from companion.person_link_codes
  where code = p_code and redeemed_at is null and expires_at > now();
  if v_link is null then
    raise exception 'invalid_or_expired_code';
  end if;

  return query
    select split_part(p.full_name, ' ', 1),
           left(reverse(split_part(reverse(p.full_name), ' ', 1)), 1),
           p.dob,
           o.name
    from   companion.clients c
    join   companion.persons p on p.id = c.person_id
    join   companion.organisations o on o.id = c.org_id
    where  c.id = v_link.source_client_id;
end;
$$;

-- ── 3. Confirm — commits the link (rules 4, 6, 7) ───────────────────
create or replace function public.confirm_person_link(p_code text, p_target_client_id uuid)
returns void
language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_link          companion.person_link_codes;
  v_source_person uuid;
  v_target_person uuid;
  v_target_group_size int;
begin
  if not companion.is_participant_or_decision_maker(p_target_client_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select * into v_link from companion.person_link_codes
  where code = p_code and redeemed_at is null and expires_at > now()
  for update;
  if v_link is null then
    raise exception 'invalid_or_expired_code';
  end if;

  if v_link.source_client_id = p_target_client_id then
    raise exception 'cannot_link_to_self';
  end if;

  select person_id into v_source_person from companion.clients where id = v_link.source_client_id;
  select person_id into v_target_person from companion.clients where id = p_target_client_id;

  -- No chaining (rule 7): refuse if the target is already itself part
  -- of a merged cabinet. See the file header for why this side, not
  -- the source side, is where the guard belongs.
  select count(*) into v_target_group_size
  from companion.clients where person_id = v_target_person;
  if v_target_group_size > 1 then
    raise exception 'target_already_linked';
  end if;

  insert into companion.person_links (person_id, client_id, linked_by, link_code_id)
  values (v_source_person, p_target_client_id, auth.uid(), v_link.id);

  update companion.clients set person_id = v_source_person where id = p_target_client_id;

  update companion.person_link_codes
  set redeemed_at = now(), redeemed_by = auth.uid(), target_client_id = p_target_client_id
  where id = v_link.id;
end;
$$;

-- ── 4. Unlink — reversible (rule 6): ends the link, gives the drawer
--       a fresh person snapshotting current shared data ───────────
create or replace function public.unlink_person(p_client_id uuid)
returns void
language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_current_person companion.persons;
  v_new_person_id  uuid;
  v_group_size     int;
begin
  if not companion.is_participant_or_decision_maker(p_client_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select p.* into v_current_person
  from   companion.clients c join companion.persons p on p.id = c.person_id
  where  c.id = p_client_id;

  select count(*) into v_group_size
  from companion.clients where person_id = v_current_person.id;
  if v_group_size <= 1 then
    raise exception 'not_linked';
  end if;

  update companion.person_links
  set unlinked_at = now(), unlinked_by = auth.uid()
  where client_id = p_client_id and unlinked_at is null;

  insert into companion.persons (full_name, dob, about, recipient_profile_id)
  values (v_current_person.full_name, v_current_person.dob, v_current_person.about,
          v_current_person.recipient_profile_id)
  returning id into v_new_person_id;

  update companion.clients set person_id = v_new_person_id where id = p_client_id;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default.
revoke execute on function companion.is_participant_or_decision_maker(uuid) from public, anon, authenticated;
revoke execute on function
  public.generate_person_link_code(uuid), public.preview_person_link(text, uuid),
  public.confirm_person_link(text, uuid), public.unlink_person(uuid)
  from public, anon;
grant execute on function
  public.generate_person_link_code(uuid), public.preview_person_link(text, uuid),
  public.confirm_person_link(text, uuid), public.unlink_person(uuid)
  to authenticated;

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · RLS enabled, zero table grants on both tables.
select relname, relrowsecurity from pg_class
where relnamespace = 'companion'::regnamespace and relname in ('person_link_codes', 'person_links');
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'companion' and table_name in ('person_link_codes', 'person_links')
  and grantee in ('anon', 'authenticated');
-- ^ must return zero rows.

-- V2 · EXECUTE grants land exactly where intended — the four public
--      RPCs to authenticated only, the internal helper to nobody.
select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_execute
from   pg_proc p
join   pg_namespace n on n.oid = p.pronamespace
cross  join (select oid, rolname from pg_roles where rolname in ('anon','authenticated')) r
where  n.nspname in ('public','companion')
  and  p.proname in ('generate_person_link_code','preview_person_link','confirm_person_link',
                      'unlink_person','is_participant_or_decision_maker')
order  by p.proname, r.rolname;

-- ── Behavioural — needs two real client rows and a real participant/
--    decision-maker session; cannot be run from the SQL editor.
-- V3 · A coordinator or worker calling generate_person_link_code /
--      preview_person_link / confirm_person_link / unlink_person on
--      ANY client → refused (42501), every single time.
-- V4 · The full happy path: source's decision-maker generates a code;
--      target's decision-maker previews it (sees first name, last
--      initial, dob, source org name — nothing else); confirms;
--      target's clients.person_id now equals source's; a person_links
--      row exists with linked_by = the confirming profile.
-- V5 · Redeeming an expired or already-redeemed code → refused
--      (invalid_or_expired_code), not silently accepted.
-- V6 · Chaining refused: link B to A (fine), then attempt to link B
--      (now sharing A's person) to C as if B were the target → refused
--      (target_already_linked). Linking a THIRD drawer to A itself
--      (A as source again) must still succeed — that is not chaining.
-- V7 · Unlink restores isolation: after unlink_person on the target
--      from V4, its clients.person_id no longer equals the source's,
--      the person_links row shows unlinked_at set, and the target's
--      full_name/dob/about are unchanged (the snapshot carried them
--      over).
