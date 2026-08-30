-- ═══════════════════════════════════════════════════════════════════
-- 069 · Every write path that touches profiles.role or invites.role
--       learns about sub_role_id, and promote_member stops minting
--       'trusted_support_worker'. Runs BEFORE any data moves, so the
--       window in which the retired value can be re-created is
--       structurally empty rather than merely narrow.
--
-- Every rewritten function below has been diffed against the live
-- pg_get_functiondef() output (2026-08-23) and corrected to match —
-- three real discrepancies were caught and fixed this way: promote_member
-- /demote_member were dropping 'new_role' from their success payload,
-- setup_family_org was missing client_family.relationship = 'primary_carer'
-- and clients.active = true, and accept_invite's error shape didn't match
-- what AcceptInvite.tsx actually pattern-matches on.
--
-- Also adds the `invites` permissive policies for sub-roled workers.
-- They are additive: sub_role_invitable_roles is empty for every default
-- sub-role, so they admit nothing until 070 backfills.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1 · promote_member: refuse the retired value ───────────────────
-- Verified against the live body (I9): matches exactly except the new
-- 'trusted_support_worker' refusal branch (replacing the old conditional
-- promotion) and sub_role_id. Returns {ok:false,error}, not an exception,
-- so a stale PWA client shows a clean message rather than a raw
-- constraint violation.
create or replace function companion.promote_member(p_user_id uuid, p_new_role text)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
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

  -- role and sub_role_id MOVE TOGETHER. A second statement fails the
  -- composite FK; there is no coordinator sub-role by construction.
  update companion.profiles
    set role = p_new_role, sub_role_id = null
    where id = p_user_id and org_id = v_org_id;

  return json_build_object('ok', true, 'new_role', p_new_role);
end $$;

-- ── 2 · demote_member ──────────────────────────────────────────────
-- Verified against the live body (I9): identical except sub_role_id and
-- the return payload. Keeps the trusted->support_worker branch: it
-- performs exactly the conversion 071 performs, so it is harmless while
-- data still holds the retired value. Removed in cleanup.
create or replace function companion.demote_member(p_user_id uuid)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
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

  -- NULL falls back to the new base role's org default via
  -- effective_sub_role()'s branch (b) — no extra lookup needed.
  update companion.profiles
    set role = v_new_role, sub_role_id = null
    where id = p_user_id and org_id = v_org_id;

  return json_build_object('ok', true, 'new_role', v_new_role);
end $$;

-- ── 3 · accept_invite ──────────────────────────────────────────────
-- Verified against the live body (I9) — matched EXACTLY (row lock via
-- `for update`, auth.email(), the json_build_object('error', ...) shape
-- with no 'ok' key on failure) except one addition: sub_role_id carried
-- onto the profile in the same UPDATE. Deliberately NOT adding a
-- coordinator-downgrade guard here — the live body has never had one
-- (unlike redeem-invite/index.ts, which does), and that asymmetry is a
-- pre-existing, unrelated gap, not something to fix inside this
-- migration.
create or replace function companion.accept_invite(p_token text)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
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
end $$;

-- ── 4 · remove_member ──────────────────────────────────────────────
-- Four fixes vs the live 012 version:
--   (a) nulls sub_role_id;
--   (b) DELETES the link rows — client_ids_for_worker() has no org test,
--       and clients SELECT / behaviour_notes SELECT/UPDATE have no role
--       AND no org test, so a removed worker otherwise retained read
--       access to their old org's participant records and behaviour
--       notes;
--   (c) stops minting role='coordinator' on a detached profile — relies
--       on org_id is null instead, which permissions_for now denies;
--   (d) recreated in `companion` and revoked in `public`, since it was
--       reachable there with a Content-Profile: public header even
--       though the app's client is schema-pinned.
create or replace function companion.remove_member(p_user_id uuid)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
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

  return json_build_object('ok', true);
end $$;

revoke all on function public.remove_member(uuid) from public, anon, authenticated;
revoke execute on function companion.remove_member(uuid) from public, anon;
grant  execute on function companion.remove_member(uuid) to authenticated;

-- ── 5 · create_organisation ────────────────────────────────────────
-- Without `sub_role_id = null` here, a previously-removed member (or any
-- profile carrying a stale pointer) hits profiles_sub_role_fk looking
-- for a base_role='coordinator' sub-role — forbidden by
-- sub_roles_no_coordinator — and this RPC would raise, permanently
-- blocking that person from ever creating an org.
create or replace function companion.create_organisation(
  p_name text, p_state text, p_services text[]
) returns uuid language plpgsql security definer
set search_path = 'companion', 'public' as $$
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

  insert into companion.org_settings (org_id) values (v_org_id);
  perform companion.ensure_default_sub_roles(v_org_id);
  return v_org_id;
end $$;
revoke execute on function companion.create_organisation(text,text,text[]) from public, anon;
grant  execute on function companion.create_organisation(text,text,text[]) to authenticated;

-- ── 6 · setup_family_org ── same hard block, family-plan signup ────
-- Verified against the live body (I9): live pre-generates both UUIDs
-- rather than using `returning id into`, sets client_family.relationship
-- = 'primary_carer' (omitted in the first draft — would have shipped
-- every new family signup with a null relationship), and sets
-- clients.active = true explicitly. Matched exactly below, plus
-- sub_role_id = null and the ensure_default_sub_roles call.
create or replace function companion.setup_family_org(p_participant_name text)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
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

  insert into companion.clients (id, org_id, full_name, active)
  values (v_client_id, v_org_id, p_participant_name, true);

  insert into companion.client_family (client_id, family_id, relationship, status)
  values (v_client_id, v_uid, 'primary_carer', 'active');

  perform companion.ensure_default_sub_roles(v_org_id);
  return json_build_object('ok', true, 'org_id', v_org_id, 'client_id', v_client_id);
end $$;
revoke execute on function companion.setup_family_org(text) from public, anon;
grant  execute on function companion.setup_family_org(text) to authenticated;

-- ── 7 · get_org_members: surface the sub-role ──────────────────────
drop function if exists public.get_org_members();
drop function if exists companion.get_org_members();
create function companion.get_org_members()
returns table (id uuid, full_name text, role text, email text, phone text,
               sub_role_id uuid, sub_role_name text)
language sql security definer set search_path = 'companion', 'public' as $$
  select p.id, p.full_name, p.role, u.email, p.phone,
         p.sub_role_id, s.name
  from   companion.profiles p
  join   auth.users u on u.id = p.id
  left   join companion.sub_roles s on s.id = p.sub_role_id
  where  p.org_id = public.my_org_id()
  order  by p.role, p.full_name;
$$;
revoke execute on function companion.get_org_members() from public, anon;
grant  execute on function companion.get_org_members() to authenticated;

-- ── 8 · invites: the permissive policies for sub-roled workers ─────
-- invite_members is kind='grant', NOT a gate: after 071 drops the two
-- trusted-only policies a support_worker has NO permissive INSERT on
-- invites at all. These admit nothing today (sub_role_invitable_roles is
-- empty everywhere) and light up exactly when 070 backfills.
drop policy if exists "sub-roled members can create allowed invites" on companion.invites;
create policy "sub-roled members can create allowed invites"
  on companion.invites for insert to authenticated
  with check (
    org_id = public.my_org_id()
    and role in (select companion.my_invitable_roles())
    and (select companion.has_perm('invite_members'))
  );

drop policy if exists "sub-roled members can view their allowed invites" on companion.invites;
create policy "sub-roled members can view their allowed invites"
  on companion.invites for select to authenticated
  using (
    org_id = public.my_org_id()
    and role in (select companion.my_invitable_roles())
    and (select companion.has_perm('invite_members'))
  );

-- ── 9 · Forward-compat shim for stale PWA clients ─────────────────
-- Without this, a stale coordinator's Save on PermissionsPage becomes a
-- silent no-op once the new code reads my_permissions() instead. This
-- translates a legacy write into the org's default sub-roles, clamped by
-- max_allowed, storing only what DIFFERS from the default. Removed in
-- cleanup.
create or replace function companion.tg_org_settings_legacy_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text; v_perms jsonb; v_key text; v_val jsonb;
  v_sub uuid; v_default boolean; v_max boolean; v_allowed boolean;
begin
  if new.permissions is null then return new; end if;
  if tg_op = 'UPDATE' and new.permissions is not distinct from old.permissions then
    return new;
  end if;

  for v_role, v_perms in select * from pg_catalog.jsonb_each(new.permissions) loop
    if pg_catalog.jsonb_typeof(v_perms) <> 'object' then continue; end if;
    select s.id into v_sub from companion.sub_roles s
     where s.org_id = new.org_id and s.base_role = v_role
       and s.is_default and s.archived_at is null limit 1;
    if v_sub is null then continue; end if;

    for v_key, v_val in select * from pg_catalog.jsonb_each(v_perms) loop
      if pg_catalog.jsonb_typeof(v_val) <> 'boolean' then continue; end if;
      select d.default_allowed, d.max_allowed into v_default, v_max
        from companion.role_permission_defaults d
       where d.base_role = v_role and d.permission_key = v_key;
      if v_max is null then continue; end if;
      v_allowed := (v_val #>> '{}')::boolean and v_max;
      if v_allowed = v_default then
        delete from companion.sub_role_permissions
         where sub_role_id = v_sub and permission_key = v_key;
      else
        insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
        values (v_sub, v_key, v_allowed)
        on conflict (sub_role_id, permission_key) do update set allowed = excluded.allowed;
      end if;
    end loop;
  end loop;
  return new;
end $$;
drop trigger if exists org_settings_legacy_permissions on companion.org_settings;
create trigger org_settings_legacy_permissions
  before insert or update on companion.org_settings
  for each row execute function companion.tg_org_settings_legacy_permissions();

-- ── 10 · client_ids_for_worker gains an org test ───────────────────
-- ⚠ The one genuinely behaviour-changing statement in this file. For any
--   correctly-membered worker it is a no-op (c.org_id always equals
--   their org_id). It only bites a profile whose org_id no longer
--   matches its assignments — the detached case. Run the population
--   check in the companion message first; it must return zero rows for
--   the one real org before this is safe.
create or replace function public.client_ids_for_worker()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select cw.client_id
  from   companion.client_workers cw
  join   companion.clients c on c.id = cw.client_id
  where  cw.worker_id = auth.uid()
    and  c.org_id = public.my_org_id()
$$;

-- ── 11 · VALIDATE the composite FKs ───────────────────────────────
alter table companion.profiles validate constraint profiles_sub_role_fk;
alter table companion.invites  validate constraint invites_sub_role_fk;

commit;
