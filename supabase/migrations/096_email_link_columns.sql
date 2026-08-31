-- ═══════════════════════════════════════════════════════════════════
-- 096 · Unified invite & email auto-link, step 1 — additive only
--       (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-30-unified-invite-
-- email-autolink-design.md §6. This migration alone changes NO
-- behaviour: it adds three nullable/defaulted columns, extends 082's
-- BEFORE INSERT trigger to also fire on UPDATE, changes one line of
-- accept_invite, and adds one column to unlink_person's snapshot.
-- The RPCs that actually use any of it land in 097.
--
-- WHY persons.email has NO unique constraint: a shared family email
-- producing several persons rows is a DESIGNED ambiguity case (the
-- linking RPCs return `ambiguous_email_match` and fall back to the
-- manual code flow), not corruption. A unique constraint would turn
-- that ordinary situation into a hard insert failure on the
-- add-participant form.
--
-- WHY the trigger gains an UPDATE branch: accept_invite sets
-- clients.recipient_profile_id (and, from this migration, clients.email)
-- on an EXISTING row. Without an UPDATE branch none of it ever reaches
-- the person-level copy, so the acceptance card would have no match key
-- to work from. First value promoted wins — a later, differing email on
-- another enrolment stays enrolment-only and never becomes a match key.
--
-- THE recipient_profile_id PROMOTE (spec §6.7): no accept_invite
-- lineage (026, 041, 069, 083) has ever synced clients.recipient_
-- profile_id to the person-level copy, and 080's
-- client_ids_for_recipient() reads the person-level copy. So a
-- recipient who accepted an invite after 077 has the clients-side set
-- and the persons-side null, and the merged-view helper returns nothing
-- for them. That is live-broken today, independent of this design. It
-- rides the same UPDATE branch, with the same first-wins semantics.
-- I6 below counts how many rows are currently in that state.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · Current columns on persons and clients — `email` must not
--      already exist on either.
select table_name, column_name, data_type, is_nullable
from   information_schema.columns
where  table_schema = 'companion' and table_name in ('persons','clients')
order  by table_name, ordinal_position;

-- I2 · Current columns on person_links — `link_method` must not
--      already exist.
select column_name, data_type, is_nullable, column_default
from   information_schema.columns
where  table_schema = 'companion' and table_name = 'person_links'
order  by ordinal_position;

-- I3 · Live body of the trigger function this migration replaces
--      (082's version). Read it before replacing it — never work from
--      a remembered body.
select pg_get_functiondef(oid) from pg_proc
where  proname = 'auto_create_person_for_client'
  and  pronamespace = 'companion'::regnamespace;

-- I4 · Live body of accept_invite (083's version) — the migration
--      below reproduces it verbatim with ONE line changed.
select pg_get_functiondef(oid) from pg_proc
where  proname = 'accept_invite' and pronamespace = 'companion'::regnamespace;

-- I5 · Live body of unlink_person (081's version) — same deal, one
--      column added to its snapshot INSERT.
select pg_get_functiondef(oid) from pg_proc
where  proname = 'unlink_person' and pronamespace = 'public'::regnamespace;

-- I6 · Spec §6.7 — how many enrolments currently have a recipient
--      login on the clients row but NOT on the person row. Every one
--      of these is a participant for whom client_ids_for_recipient()
--      returns nothing today. This migration fixes them going forward
--      (on the next update of the row); it deliberately does NOT
--      backfill — a backfill would need its own reviewed decision
--      about which enrolment's login wins per person.
select c.id as client_id, c.org_id, c.full_name,
       c.recipient_profile_id as client_side, p.recipient_profile_id as person_side
from   companion.clients c
join   companion.persons p on p.id = c.person_id
where  c.recipient_profile_id is not null and p.recipient_profile_id is null
order  by c.org_id, c.full_name;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

-- ── 1 · Columns ─────────────────────────────────────────────────────
alter table companion.persons      add column if not exists email text;
alter table companion.clients      add column if not exists email text;
alter table companion.person_links add column if not exists link_method text not null default 'code';

-- Existing person_links rows become 'code' via the default above.
-- Email-linked rows carry link_code_id null (already nullable).
alter table companion.person_links drop constraint if exists person_links_link_method_check;
alter table companion.person_links add  constraint person_links_link_method_check
  check (link_method in ('code','email'));

-- ── 2 · The trigger: INSERT carries email, UPDATE promotes ──────────
-- Normalising email on the row itself (lower + trim, '' → null) is the
-- reason every downstream comparison can be a plain `=` against
-- lower(auth.email()) instead of a function call that would defeat any
-- future index.
create or replace function companion.auto_create_person_for_client()
returns trigger language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_person_id uuid;
begin
  new.email := nullif(lower(trim(new.email)), '');

  if tg_op = 'INSERT' then
    if new.person_id is null then
      insert into companion.persons (full_name, dob, about, recipient_profile_id, email)
      values (new.full_name, new.dob, new.about, new.recipient_profile_id, new.email)
      returning id into v_person_id;
      new.person_id := v_person_id;
    end if;
    return new;
  end if;

  -- UPDATE: promote to the person-level copy, first value wins. Both
  -- updates are no-ops once the person row already carries a value —
  -- that is what makes "first wins" true without extra branching.
  if new.person_id is not null then
    if new.email is not null then
      update companion.persons
      set    email = new.email
      where  id = new.person_id and email is null;
    end if;

    if new.recipient_profile_id is not null then
      update companion.persons
      set    recipient_profile_id = new.recipient_profile_id
      where  id = new.person_id and recipient_profile_id is null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists clients_auto_create_person on companion.clients;
create trigger clients_auto_create_person
  before insert or update on companion.clients
  for each row execute function companion.auto_create_person_for_client();

-- ── 3 · accept_invite — 083's body, ONE line changed ────────────────
-- The recipient branch now sets clients.email from the invite when the
-- enrolment has none. The trigger's UPDATE branch above then promotes
-- it to persons.email. This is what makes the acceptance card possible
-- when the coordinator never typed an email on the participant form.
create or replace function companion.accept_invite(p_token text)
returns json
language plpgsql security definer
set search_path = 'companion', 'public' as $function$
declare
  v_invite   companion.invites%rowtype;
  v_uid      uuid := auth.uid();
  v_email    text := auth.email();
  v_sub      uuid;
begin
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  select * into v_invite
  from companion.invites
  where token = p_token and status = 'pending'
  for update;

  if not found then
    return json_build_object('error', 'invalid_or_used');
  end if;

  if v_invite.expires_at < now() then
    update companion.invites set status = 'expired' where id = v_invite.id;
    return json_build_object('error', 'expired');
  end if;

  if lower(v_invite.email) != lower(v_email) then
    return json_build_object('error', 'invite_not_for_this_account');
  end if;

  v_sub := v_invite.sub_role_id;
  if v_sub is null and v_invite.role <> 'coordinator' then
    select s.id into v_sub from companion.sub_roles s
     where s.org_id = v_invite.org_id and s.base_role = v_invite.role
       and s.is_default and s.archived_at is null limit 1;
  end if;

  update companion.profiles
  set org_id = v_invite.org_id, role = v_invite.role, sub_role_id = v_sub
  where id = v_uid;

  -- Keep profile_orgs in sync — this is what my_org_id()/my_role()
  -- actually read since 079. ON CONFLICT handles re-joining an org
  -- this profile had previously left.
  insert into companion.profile_orgs (profile_id, org_id, role, sub_role_id)
  values (v_uid, v_invite.org_id, v_invite.role, v_sub)
  on conflict (profile_id, org_id) do update
    set role = excluded.role, sub_role_id = excluded.sub_role_id, left_at = null;

  if v_invite.client_id is not null then
    if v_invite.role = 'family' then
      insert into companion.client_family (client_id, family_id, status)
      values (v_invite.client_id, v_uid, 'active')
      on conflict (client_id, family_id) do update set status = 'active';
    elsif v_invite.role in ('support_worker', 'trusted_support_worker') then
      insert into companion.client_workers (client_id, worker_id)
      values (v_invite.client_id, v_uid)
      on conflict (client_id, worker_id) do nothing;
    elsif v_invite.role = 'recipient' then
      update companion.clients
      set    recipient_profile_id = v_uid,
             email = coalesce(email, lower(v_invite.email))
      where  id = v_invite.client_id;
    elsif v_invite.role = 'therapist' then
      insert into companion.client_circle (client_id, therapist_id, status)
      values (v_invite.client_id, v_uid, 'in_circle')
      on conflict (client_id, therapist_id) do update set status = 'in_circle';
    end if;
  end if;

  update companion.invites set status = 'accepted' where id = v_invite.id;

  return json_build_object(
    'ok',     true,
    'role',   v_invite.role,
    'org_id', v_invite.org_id::text
  );
end $function$;

-- ── 4 · unlink_person — 081's body, snapshot carries email ──────────
-- The two INSERT-into-persons sites in this whole design (the trigger
-- above and this snapshot) both carry email, so an unlinked drawer
-- keeps its match key rather than silently losing it.
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

  insert into companion.persons (full_name, dob, about, recipient_profile_id, email)
  values (v_current_person.full_name, v_current_person.dob, v_current_person.about,
          v_current_person.recipient_profile_id, v_current_person.email)
  returning id into v_new_person_id;

  update companion.clients set person_id = v_new_person_id where id = p_client_id;
end;
$$;

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · The three columns exist, all nullable-or-defaulted, and
--      persons.email has NO unique constraint (by design).
select table_name, column_name, data_type, is_nullable, column_default
from   information_schema.columns
where  table_schema = 'companion'
  and  (table_name, column_name) in
       (('persons','email'), ('clients','email'), ('person_links','link_method'));

select conname, pg_get_constraintdef(oid) from pg_constraint
where  conrelid = 'companion.persons'::regclass and contype = 'u';
-- ^ must NOT list any constraint covering `email`.

select conname, pg_get_constraintdef(oid) from pg_constraint
where  conrelid = 'companion.person_links'::regclass
  and  conname = 'person_links_link_method_check';

-- V2 · Every pre-existing person_links row picked up 'code'.
select link_method, count(*) from companion.person_links group by link_method;

-- V3 · The trigger now fires BEFORE INSERT OR UPDATE, per row.
select tgname, pg_get_triggerdef(oid) from pg_trigger
where  tgrelid = 'companion.clients'::regclass
  and  tgname = 'clients_auto_create_person';

-- V4 · Behavioural — INSERT carries + normalises email; UPDATE
--      promotes email and recipient_profile_id first-wins; a SECOND,
--      differing email does NOT overwrite. Cleans up after itself.
do $$
declare
  v_org       uuid;
  v_profile   uuid;
  v_client    uuid;
  v_person    uuid;
  v_email     text;
  v_recip     uuid;
begin
  select id into v_org     from companion.organisations limit 1;
  select id into v_profile from companion.profiles      limit 1;

  -- INSERT path: email normalised (lower + trim) onto the new person.
  insert into companion.clients (org_id, full_name, email, active)
  values (v_org, '__096_trigger_test__', '  MiXeD@Example.COM  ', true)
  returning id, person_id into v_client, v_person;

  select email into v_email from companion.persons where id = v_person;
  if v_email is distinct from 'mixed@example.com' then
    raise exception 'V4 FAILED (insert): persons.email = %, expected mixed@example.com', v_email;
  end if;

  -- UPDATE path, email: a DIFFERENT email must NOT overwrite the first.
  update companion.clients set email = 'second@example.com' where id = v_client;
  select email into v_email from companion.persons where id = v_person;
  if v_email is distinct from 'mixed@example.com' then
    raise exception 'V4 FAILED (first-wins): persons.email = %, expected mixed@example.com', v_email;
  end if;

  -- UPDATE path, recipient_profile_id: promoted when the person has none.
  update companion.clients set recipient_profile_id = v_profile where id = v_client;
  select recipient_profile_id into v_recip from companion.persons where id = v_person;
  if v_recip is distinct from v_profile then
    raise exception 'V4 FAILED (recipient promote): persons.recipient_profile_id = %, expected %', v_recip, v_profile;
  end if;

  delete from companion.clients where id = v_client;
  delete from companion.persons where id = v_person;

  raise notice 'V4 PASSED: insert-carries, first-wins email, recipient promote all correct; test rows cleaned up';
end $$;

-- V5 · Behavioural — an INSERT with a null/blank email leaves
--      persons.email null (no empty strings sneaking in as match keys).
do $$
declare
  v_org uuid; v_client uuid; v_person uuid; v_email text;
begin
  select id into v_org from companion.organisations limit 1;

  insert into companion.clients (org_id, full_name, email, active)
  values (v_org, '__096_blank_email_test__', '   ', true)
  returning id, person_id into v_client, v_person;

  select email into v_email from companion.persons where id = v_person;
  if v_email is not null then
    raise exception 'V5 FAILED: blank email stored as %, expected null', quote_literal(v_email);
  end if;

  delete from companion.clients where id = v_client;
  delete from companion.persons where id = v_person;

  raise notice 'V5 PASSED: blank email normalised to null on both rows; test rows cleaned up';
end $$;

-- ── Behavioural, needs a real session (documented, not runnable here) ──
-- V6 · Accept a recipient invite for an enrolment whose clients.email
--      is null → afterwards clients.email equals the invite's email
--      (lowercased) AND persons.email equals it too. This is the
--      acceptance card's precondition (spec §8).
