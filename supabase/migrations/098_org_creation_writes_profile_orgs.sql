-- ═══════════════════════════════════════════════════════════════════
-- 098 · URGENT FIX — the two org-CREATION RPCs never kept profile_orgs
--       in sync either (idempotent)
--
-- The same gap 083 closed for the four MEMBERSHIP RPCs, in the two
-- functions 083 missed. 078 backfilled companion.profile_orgs ONCE from
-- profiles.org_id/role/sub_role_id. 079 then made my_org_id()/my_role()
-- read from profile_orgs, not profiles. 083 fixed accept_invite,
-- promote_member, demote_member and remove_member — but
-- companion.setup_family_org() and companion.create_organisation()
-- (both still on their 069 bodies) also write profiles and nothing else:
--
--   $ grep -n "profile_orgs" supabase/migrations/069_sub_role_write_paths.sql
--   (no matches)
--
-- So a person who creates an organisation — a family signing up, or a
-- provider org being created — ends up with profiles.org_id set and NO
-- profile_orgs row at all. Since 079, that means my_org_id() and
-- my_role() both return NULL for them: every RLS policy written as
-- `org_id = my_org_id()` matches nothing, and the brand-new org's
-- creator cannot read or write their own org's rows.
--
-- SURFACED BY: the unified-invite branch's participant-email step
-- (src/pages/setup/family/FamilyStep1Participant.tsx). It calls
-- setup_family_org(), then refreshProfile(), then stamps the
-- participant's email with `.update({ email }).eq('id', clientId)` on
-- companion.clients — which RLS gates on
-- `org_id = my_org_id() and my_role() = 'coordinator'`. With no
-- profile_orgs row the update matches zero rows, `.single()` errors, and
-- the email is silently never stored. That feature cannot work at all
-- until this is fixed. The linking flow downstream of it depends on the
-- same email, so it is not a cosmetic failure.
--
-- WHY A NEW MIGRATION rather than editing 069: 069 has already been
-- applied to the live database. `create or replace function` in a fresh
-- file is how 083 fixed the identical class of bug in its four
-- siblings, and this file follows it deliberately.
--
-- THE FIX: each RPC keeps its exact existing logic, ordering and error
-- shape; this only ADDS the matching profile_orgs upsert next to the
-- existing profiles write, so the two never diverge. ON CONFLICT handles
-- re-creating an org membership a profile had previously left, exactly
-- as 083's accept_invite does. Nothing else changes — not the return
-- payloads, not the guards, and not the grants (both functions keep the
-- ones 069 gave them; their signatures are unchanged).
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · Live bodies of the two functions this migration replaces. Read
--      them before replacing them — never work from a remembered body.
select proname, pg_get_functiondef(oid) from pg_proc
where  proname in ('setup_family_org','create_organisation')
  and  pronamespace = 'companion'::regnamespace;

-- I2 · THE EVIDENCE — every profile that has an org today but NO active
--      profile_orgs row for it. Each one of these is a live account for
--      which my_org_id()/my_role() return NULL right now, i.e. someone
--      locked out of their own organisation. Expect one row per org
--      created via either RPC since 078 shipped; zero rows means no org
--      has been created since then and this is a latent bug only.
select p.id, p.full_name, p.role as profile_role, p.org_id,
       o.name as org_name, o.org_type, o.created_at as org_created
from   companion.profiles p
join   companion.organisations o on o.id = p.org_id
left   join companion.profile_orgs po
       on po.profile_id = p.id and po.org_id = p.org_id and po.left_at is null
where  p.org_id is not null and po.profile_id is null
order  by o.created_at;
--
-- ⚠ If I2 returns rows, this migration fixes the CAUSE but not those
--   rows — they need a one-off repair, reviewed on its own, of the shape
--   083's header describes:
--
--     insert into companion.profile_orgs (profile_id, org_id, role, sub_role_id, joined_at)
--     select p.id, p.org_id, p.role, p.sub_role_id, p.created_at
--     from   companion.profiles p
--     where  p.org_id is not null
--     on conflict (profile_id, org_id) do nothing;
--
--   Deliberately NOT run here: it is a data change over live rows, and
--   it must be read against I2's actual output (in particular, that
--   every listed profile's profiles.role is still the role that account
--   should hold) rather than applied sight-unseen.

-- I3 · The other direction — organisations with no active coordinator
--      membership at all. Should be empty; a non-empty result is the
--      same drift seen per-org rather than per-profile.
select o.id, o.name, o.org_type, o.created_at
from   companion.organisations o
where  not exists (
  select 1 from companion.profile_orgs po
  where  po.org_id = o.id and po.role = 'coordinator' and po.left_at is null
)
order  by o.created_at;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

-- ── 1 · create_organisation — 069's body, one INSERT added ──────────
create or replace function companion.create_organisation(
  p_name text, p_state text, p_services text[]
) returns uuid language plpgsql security definer
set search_path = 'companion', 'public' as $function$
declare v_uid uuid := auth.uid(); v_current_org uuid; v_org_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select org_id into v_current_org from companion.profiles where id = v_uid;
  if v_current_org is not null then raise exception 'already_in_org'; end if;

  insert into companion.organisations (name, state, services, plan, billing_status)
  values (p_name, p_state, coalesce(p_services, '{}'), 'trial', 'trial')
  returning id into v_org_id;

  update companion.profiles
    set org_id = v_org_id, role = 'coordinator', sub_role_id = null
    where id = v_uid;

  -- The actual fix. Without this the creator has no profile_orgs row, so
  -- my_org_id()/my_role() — which stopped reading profiles at 079 —
  -- resolve to NULL and every `org_id = my_org_id()` policy locks them
  -- out of the organisation they just created. sub_role_id is null for
  -- the same reason 069 nulls it on profiles: there is no coordinator
  -- sub-role by construction (sub_roles_no_coordinator), and a null
  -- leaves profile_orgs_sub_role_fk unenforced, so this is safe to run
  -- before ensure_default_sub_roles below.
  insert into companion.profile_orgs (profile_id, org_id, role, sub_role_id)
  values (v_uid, v_org_id, 'coordinator', null)
  on conflict (profile_id, org_id) do update
    set role = excluded.role, sub_role_id = excluded.sub_role_id, left_at = null;

  insert into companion.org_settings (org_id) values (v_org_id);
  perform companion.ensure_default_sub_roles(v_org_id);
  return v_org_id;
end $function$;

-- ── 2 · setup_family_org — 069's body, one INSERT added ─────────────
create or replace function companion.setup_family_org(p_participant_name text)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $function$
declare
  v_uid       uuid := auth.uid();
  v_org_id    uuid := gen_random_uuid();
  v_client_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  insert into companion.organisations (id, name, plan, billing_status, org_type)
  values (v_org_id, p_participant_name || '''s Care Circle', 'family', 'trial', 'family');

  insert into companion.org_settings (org_id) values (v_org_id);

  -- Creator is the coordinator, not a family-role member.
  update companion.profiles
    set org_id = v_org_id, role = 'coordinator', sub_role_id = null
    where id = v_uid;

  -- The actual fix — see create_organisation above for the full
  -- reasoning. This is the one that blocks the participant-email step of
  -- family setup today: without the row here, the `.update({ email })`
  -- that runs immediately after this RPC matches zero rows.
  insert into companion.profile_orgs (profile_id, org_id, role, sub_role_id)
  values (v_uid, v_org_id, 'coordinator', null)
  on conflict (profile_id, org_id) do update
    set role = excluded.role, sub_role_id = excluded.sub_role_id, left_at = null;

  insert into companion.clients (id, org_id, full_name, active)
  values (v_client_id, v_org_id, p_participant_name, true);

  insert into companion.client_family (client_id, family_id, relationship, status)
  values (v_client_id, v_uid, 'primary_carer', 'active');

  perform companion.ensure_default_sub_roles(v_org_id);
  return json_build_object('ok', true, 'org_id', v_org_id, 'client_id', v_client_id);
end $function$;

-- Grants are deliberately untouched: 069 already revoked both from
-- public/anon and granted them to authenticated, and neither signature
-- changes here, so `create or replace` preserves them.

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · Structural — both bodies now reference profile_orgs, and both are
--      still SECURITY DEFINER with the same search_path.
select proname,
       pg_get_functiondef(oid) like '%profile_orgs%' as writes_profile_orgs,
       prosecdef, proconfig
from   pg_proc
where  pronamespace = 'companion'::regnamespace
  and  proname in ('setup_family_org','create_organisation');
-- ^ writes_profile_orgs must be true for BOTH rows.

-- V2 · Grants unchanged — authenticated yes, anon no, for both.
select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_execute
from   pg_proc p
join   pg_namespace n on n.oid = p.pronamespace
cross  join (select oid, rolname from pg_roles where rolname in ('anon','authenticated')) r
where  n.nspname = 'companion'
  and  p.proname in ('setup_family_org','create_organisation')
order  by p.proname, r.rolname;

-- V3 · Re-run I2's drift check. This migration changes no existing data,
--      so its result is unchanged — it is here so the repair note above
--      stays visible rather than being read once and forgotten.
select p.id, p.full_name, p.role as profile_role, p.org_id, o.name as org_name
from   companion.profiles p
join   companion.organisations o on o.id = p.org_id
left   join companion.profile_orgs po
       on po.profile_id = p.id and po.org_id = p.org_id and po.left_at is null
where  p.org_id is not null and po.profile_id is null;

-- V4 · Behavioural — setup_family_org actually writes profile_orgs now.
--      Calls the REAL RPC as a real profile (auth.uid() reads the JWT
--      claims GUC, so the probe sets it locally), asserts the membership
--      row landed, then rolls the whole thing back inside a plpgsql
--      subtransaction. Nothing it touched survives — not the new org,
--      client, sub-roles or membership row, and NOT the calling
--      profile's own org_id/role/sub_role_id, which the RPC necessarily
--      overwrites while it runs. plpgsql variables are not transactional,
--      so the assertions are made from captured values AFTER the
--      rollback.
do $$
declare
  v_uid       uuid;
  v_result    json;
  v_new_org   uuid;
  v_po_role   text;
  v_po_found  boolean := false;
begin
  select id into v_uid from companion.profiles order by created_at limit 1;
  if v_uid is null then
    raise notice 'V4 SKIPPED: no profiles exist to run the probe as';
    return;
  end if;

  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

    select companion.setup_family_org('__098_probe_participant__') into v_result;
    v_new_org := (v_result ->> 'org_id')::uuid;

    if v_new_org is not null then
      select po.role into v_po_role
      from   companion.profile_orgs po
      where  po.profile_id = v_uid and po.org_id = v_new_org and po.left_at is null;
      v_po_found := found;
    end if;

    -- Unwind every write the probe just made. Caught immediately below;
    -- anything else the RPC might raise propagates as a real failure.
    raise exception using errcode = 'ZZ098', message = '__098_probe_rollback__';
  exception
    when sqlstate 'ZZ098' then null;
  end;

  if v_new_org is null then
    raise exception 'V4 FAILED: setup_family_org returned no org_id (%)', v_result::text;
  end if;
  if not v_po_found then
    raise exception 'V4 FAILED: no profile_orgs row for the org setup_family_org just created (%)', v_new_org;
  end if;
  if v_po_role is distinct from 'coordinator' then
    raise exception 'V4 FAILED: profile_orgs.role = %, expected coordinator', v_po_role;
  end if;

  raise notice 'V4 PASSED: setup_family_org wrote profile_orgs (org %, role coordinator); probe rolled back, nothing left behind', v_new_org;
end $$;

-- ── Behavioural, needs a real session (documented, not runnable here) ──
-- V5 · Sign up a brand-new family plan through the UI. On step 1, enter
--      a participant name AND an email. Afterwards
--      companion.clients.email for the new client is that email — i.e.
--      FamilyStep1Participant's post-setup `.update({ email })` now
--      matches its row instead of silently updating nothing, and no
--      '[FamilyStep1] could not store participant email' appears in the
--      browser console.
-- V6 · Same signup, then check my_org_id()/my_role() as that account:
--      they resolve to the new org and 'coordinator' immediately, with
--      no sign-out/sign-in needed.
-- V7 · create_organisation via provider signup: the creator can read and
--      write their own org's rows straight away (org settings, members,
--      participants) rather than seeing empty lists.
