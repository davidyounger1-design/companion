-- ═══════════════════════════════════════════════════════════════════
-- 083 · URGENT FIX — membership RPCs never kept profile_orgs in sync
--       (idempotent)
--
-- 078 backfilled companion.profile_orgs ONCE from profiles.org_id/role/
-- sub_role_id. 079 then made my_org_id()/my_role() read from
-- profile_orgs, not profiles, going forward. Nobody updated the RPCs
-- that actually CHANGE membership to also write profile_orgs — a gap
-- in the migration path itself (078/079), not caught until now,
-- surfaced by walking through how David would actually get the same
-- person onto both sides of a link.
--
-- Confirmed live 2026-08-25: zero drift exists yet (nobody has
-- accepted an invite, been promoted/demoted, or been removed since 079
-- shipped) — this is a latent bug, not an active incident. But it
-- would have broken the very next thing anyone does:
--
--   accept_invite() — accepting a SECOND invite (exactly what's needed
--     to get Sarah's decision-maker into both orgs) would update
--     profiles.org_id but leave profile_orgs untouched, so
--     active_org_id() would keep resolving to their FIRST org only.
--   promote_member() / demote_member() — would change what profiles
--     shows but not the role my_role() actually returns.
--   remove_member() — SECURITY ISSUE: sets profiles.org_id = null, but
--     leaves the profile_orgs row active. Since my_org_id()/my_role()
--     stopped reading profiles the moment 079 shipped, a removed
--     member would RETAIN full access under this bug — "remove" would
--     silently do nothing from an authorisation standpoint.
--
-- THE FIX: each RPC keeps its exact existing logic/authorisation
-- checks; this only ADDS the matching profile_orgs write next to the
-- existing profiles write, so the two never diverge again.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · Live bodies of the four functions this migration replaces.
select proname, pg_get_functiondef(oid) from pg_proc
where proname in ('accept_invite','promote_member','demote_member','remove_member')
  and pronamespace = 'companion'::regnamespace;

-- I2 · Confirm zero drift exists yet — must return zero rows, or this
--      migration also needs a repair pass for whoever shows up here.
select p.id, p.full_name, p.org_id as profile_org, po.org_id as membership_org
from   companion.profiles p
left   join companion.profile_orgs po on po.profile_id = p.id and po.left_at is null
where  p.org_id is distinct from po.org_id or p.role is distinct from po.role;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

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
      update companion.clients set recipient_profile_id = v_uid where id = v_invite.client_id;
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

create or replace function companion.promote_member(p_user_id uuid, p_new_role text)
returns json
language plpgsql security definer
set search_path = 'companion', 'public' as $function$
declare
  v_org_id uuid; v_caller_role text; v_target_role text; v_org_type text;
begin
  select org_id, role into v_org_id, v_caller_role
    from companion.profiles where id = auth.uid();
  if v_caller_role <> 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can promote members');
  end if;

  select role into v_target_role
    from companion.profiles where id = p_user_id and org_id = v_org_id;
  if v_target_role is null then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  if p_new_role = 'trusted_support_worker' then
    return json_build_object('ok', false,
      'error', 'Trusted worker is now a sub-role — assign it from the member''s row instead');
  elsif p_new_role = 'coordinator' then
    select org_type into v_org_type from companion.organisations where id = v_org_id;
    if v_org_type <> 'family' then
      return json_build_object('ok', false, 'error', 'Coordinator promotion is only available in family organisations');
    end if;
    if v_target_role <> 'family' then
      return json_build_object('ok', false, 'error', 'Only family members can become coordinators');
    end if;
  else
    return json_build_object('ok', false, 'error', 'Invalid promotion target role');
  end if;

  update companion.profiles
    set role = p_new_role, sub_role_id = null
    where id = p_user_id and org_id = v_org_id;

  update companion.profile_orgs
    set role = p_new_role, sub_role_id = null
    where profile_id = p_user_id and org_id = v_org_id;

  return json_build_object('ok', true, 'new_role', p_new_role);
end $function$;

create or replace function companion.demote_member(p_user_id uuid)
returns json
language plpgsql security definer
set search_path = 'companion', 'public' as $function$
declare
  v_org_id uuid; v_caller_role text; v_target_role text;
  v_org_type text; v_coord_count int; v_new_role text;
begin
  select org_id, role into v_org_id, v_caller_role
    from companion.profiles where id = auth.uid();
  if v_caller_role <> 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can demote members');
  end if;

  select role into v_target_role
    from companion.profiles where id = p_user_id and org_id = v_org_id;
  if v_target_role is null then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  if v_target_role = 'coordinator' then
    select org_type into v_org_type from companion.organisations where id = v_org_id;
    if v_org_type <> 'family' then
      return json_build_object('ok', false, 'error', 'Coordinator demotion only applies in family organisations');
    end if;
    select count(*) into v_coord_count
      from companion.profiles where org_id = v_org_id and role = 'coordinator';
    if v_coord_count <= 1 then
      return json_build_object('ok', false, 'error', 'Cannot demote the last coordinator');
    end if;
    v_new_role := 'family';
  elsif v_target_role = 'trusted_support_worker' then
    v_new_role := 'support_worker';
  else
    return json_build_object('ok', false, 'error', 'This role cannot be demoted');
  end if;

  update companion.profiles
    set role = v_new_role, sub_role_id = null
    where id = p_user_id and org_id = v_org_id;

  update companion.profile_orgs
    set role = v_new_role, sub_role_id = null
    where profile_id = p_user_id and org_id = v_org_id;

  return json_build_object('ok', true, 'new_role', v_new_role);
end $function$;

create or replace function companion.remove_member(p_user_id uuid)
returns json
language plpgsql security definer
set search_path = 'companion', 'public' as $function$
declare v_org_id uuid; v_caller_role text; v_target_role text; v_coord_count int;
begin
  select org_id, role into v_org_id, v_caller_role
    from companion.profiles where id = auth.uid();
  if v_caller_role <> 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can remove members');
  end if;

  if p_user_id = auth.uid() then
    select count(*) into v_coord_count
      from companion.profiles where org_id = v_org_id and role = 'coordinator';
    if v_coord_count <= 1 then
      return json_build_object('ok', false, 'error',
        'Cannot remove yourself — you are the only coordinator');
    end if;
  end if;

  select role into v_target_role
    from companion.profiles where id = p_user_id and org_id = v_org_id;
  if v_target_role is null then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  delete from companion.client_workers where worker_id  = p_user_id;
  delete from companion.client_family  where family_id  = p_user_id;
  delete from companion.client_circle  where therapist_id = p_user_id;
  update companion.clients set recipient_profile_id = null
    where recipient_profile_id = p_user_id;
  update companion.clients set decision_maker_id = null
    where decision_maker_id = p_user_id;

  update companion.profiles
    set org_id = null, sub_role_id = null
    where id = p_user_id;

  -- The actual fix: without this, my_org_id()/my_role() would keep
  -- resolving this "removed" member's access via their still-active
  -- profile_orgs row, since they stopped reading profiles at all.
  update companion.profile_orgs
    set left_at = now()
    where profile_id = p_user_id and org_id = v_org_id and left_at is null;

  return json_build_object('ok', true);
end $function$;

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · Structural — all four still SECURITY DEFINER, correct search_path.
select proname, prosecdef, proconfig from pg_proc
where pronamespace = 'companion'::regnamespace
  and proname in ('accept_invite','promote_member','demote_member','remove_member');

-- V2 · Re-run I2's drift check — must still return zero rows (this
--      migration changes no data, only future write behaviour).
select p.id, p.full_name, p.org_id as profile_org, po.org_id as membership_org
from   companion.profiles p
left   join companion.profile_orgs po on po.profile_id = p.id and po.left_at is null
where  p.org_id is distinct from po.org_id or p.role is distinct from po.role;

-- ── Behavioural — needs a real invite/promote/demote/remove cycle to
--    exercise; cannot be simulated from the SQL editor.
-- V3 · Accept a second invite (the actual scenario blocking Sarah's
--      linking): the accepting profile ends up with TWO active
--      profile_orgs rows, and my_org_id() with the new org's
--      x-active-org-id header returns that org — not the original one.
-- V4 · Remove a member, then re-check as them: profile_orgs shows
--      left_at set, and my_org_id()/my_role() for that org now
--      resolve to NULL — access is actually gone, not just cosmetic.
