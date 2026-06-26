-- ─────────────────────────────────────────────────────────────
-- 012 · Role system + org_type   (idempotent)
--
-- Changes:
--  • organisations.org_type ('family' | 'provider')
--  • trusted_support_worker added to role constraint
--  • setup_family_org: creator gets role='coordinator', org_type='family'
--  • coordinators can log entries (missing policy)
--  • trusted_support_worker has same view/upload access as support_worker
--  • trusted_support_worker can create support_worker invites
--  • accept_invite links trusted_support_worker to client_workers
--  • promote_member / demote_member / remove_member RPCs
--  • get_org_members RPC
-- ─────────────────────────────────────────────────────────────

-- ── 1. org_type column ───────────────────────────────────────

alter table organisations
  add column if not exists org_type text not null default 'provider'
    check (org_type in ('family', 'provider'));

-- Backfill existing family plan orgs
update organisations set org_type = 'family' where plan = 'family';

-- ── 2. Add trusted_support_worker to role constraints ────────

-- profiles: drop and recreate the role check
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
  check (role in ('coordinator','support_worker','family','therapist','trusted_support_worker'));

-- invites: drop and recreate the role check
alter table invites drop constraint if exists invites_role_check;
alter table invites
  add constraint invites_role_check
  check (role in ('coordinator','support_worker','family','therapist','trusted_support_worker'));

-- ── 3. Coordinators can log entries ──────────────────────────
-- (previously only support_workers and family had INSERT policies)

drop policy if exists "coordinators can log for org clients" on log_entries;

create policy "coordinators can log for org clients"
  on log_entries for insert
  with check (
    public.my_role() = 'coordinator'
    and author_id = auth.uid()
    and org_id = public.my_org_id()
  );

-- ── 4. trusted_support_worker: same SELECT as support_worker ─

drop policy if exists "workers can view own log entries" on log_entries;

create policy "workers can view own log entries"
  on log_entries for select
  using (
    public.my_role() in ('support_worker', 'trusted_support_worker')
    and author_id = auth.uid()
  );

-- ── 5. trusted_support_worker can log entries ────────────────

drop policy if exists "trusted workers can log for assigned clients" on log_entries;

create policy "trusted workers can log for assigned clients"
  on log_entries for insert
  with check (
    public.my_role() = 'trusted_support_worker'
    and author_id = auth.uid()
    and client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

-- ── 6. trusted_support_worker: same storage access as support_worker ─

drop policy if exists "workers can view own journal photos" on storage.objects;

create policy "workers can view own journal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-photos'
    and public.my_role() in ('support_worker', 'trusted_support_worker')
    and (string_to_array(name, '/'))[3] = auth.uid()::text
  );

-- ── 7. trusted_support_worker can create support_worker invites ─

drop policy if exists "trusted workers can create support worker invites" on invites;

create policy "trusted workers can create support worker invites"
  on invites for insert
  with check (
    org_id = public.my_org_id()
    and public.my_role() = 'trusted_support_worker'
    and role = 'support_worker'
  );

-- trusted workers can view the invites they manage
drop policy if exists "trusted workers can view support worker invites" on invites;

create policy "trusted workers can view support worker invites"
  on invites for select
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'trusted_support_worker'
    and role = 'support_worker'
  );

-- ── 8. Update setup_family_org ───────────────────────────────
-- Creator becomes coordinator (not family), org gets org_type='family'

create or replace function public.setup_family_org(
  p_participant_name text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_org_id    uuid := gen_random_uuid();
  v_client_id uuid := gen_random_uuid();
begin
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  insert into organisations (id, name, plan, billing_status, org_type)
  values (v_org_id, p_participant_name || '''s Care Circle', 'family', 'trial', 'family');

  insert into org_settings (org_id) values (v_org_id);

  -- Creator is a coordinator in a family org (not 'family' role)
  update profiles set org_id = v_org_id, role = 'coordinator' where id = v_uid;

  insert into clients (id, org_id, full_name, active)
  values (v_client_id, v_org_id, p_participant_name, true);

  -- Also link as primary carer so FamilyDashboard can find the participant
  insert into client_family (client_id, family_id, relationship, status)
  values (v_client_id, v_uid, 'primary_carer', 'active');

  return json_build_object('ok', true, 'org_id', v_org_id, 'client_id', v_client_id);
end;
$$;

grant execute on function public.setup_family_org(text) to authenticated;

-- ── 9. Update accept_invite to handle trusted_support_worker ─

create or replace function public.accept_invite(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite  invites%rowtype;
  v_uid     uuid := auth.uid();
begin
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  select * into v_invite
  from invites
  where token = p_token and status = 'pending'
  for update;

  if not found then
    return json_build_object('error', 'invalid_or_used');
  end if;

  if v_invite.expires_at < now() then
    update invites set status = 'expired' where id = v_invite.id;
    return json_build_object('error', 'expired');
  end if;

  update profiles
  set org_id = v_invite.org_id, role = v_invite.role
  where id = v_uid;

  -- Link to participant when client_id is present
  if v_invite.client_id is not null then
    if v_invite.role = 'family' then
      insert into client_family (client_id, family_id, status)
      values (v_invite.client_id, v_uid, 'active')
      on conflict (client_id, family_id) do update set status = 'active';
    elsif v_invite.role in ('support_worker', 'trusted_support_worker') then
      insert into client_workers (client_id, worker_id)
      values (v_invite.client_id, v_uid)
      on conflict (client_id, worker_id) do nothing;
    end if;
  end if;

  update invites set status = 'accepted' where id = v_invite.id;

  return json_build_object(
    'ok',     true,
    'role',   v_invite.role,
    'org_id', v_invite.org_id::text
  );
end;
$$;

-- ── 10. promote_member RPC ───────────────────────────────────
-- coordinator → can promote: family→coordinator (family orgs only),
--                              support_worker→trusted_support_worker (any org)

create or replace function public.promote_member(p_user_id uuid, p_new_role text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id       uuid;
  v_org_type     text;
  v_caller_role  text;
  v_target_role  text;
begin
  select org_id, role into v_org_id, v_caller_role
  from profiles where id = auth.uid();

  if v_caller_role != 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can promote members');
  end if;

  select role into v_target_role
  from profiles where id = p_user_id and org_id = v_org_id;

  if v_target_role is null then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  if p_new_role = 'coordinator' then
    select org_type into v_org_type from organisations where id = v_org_id;
    if v_org_type != 'family' then
      return json_build_object('ok', false, 'error', 'Coordinator promotion is only available in family organisations');
    end if;
    if v_target_role != 'family' then
      return json_build_object('ok', false, 'error', 'Only family members can become coordinators');
    end if;
  elsif p_new_role = 'trusted_support_worker' then
    if v_target_role != 'support_worker' then
      return json_build_object('ok', false, 'error', 'Only support workers can become trusted support workers');
    end if;
  else
    return json_build_object('ok', false, 'error', 'Invalid promotion target role');
  end if;

  update profiles set role = p_new_role where id = p_user_id and org_id = v_org_id;

  return json_build_object('ok', true, 'new_role', p_new_role);
end;
$$;

grant execute on function public.promote_member(uuid, text) to authenticated;

-- ── 11. demote_member RPC ────────────────────────────────────
-- coordinator→family (family orgs only; must not be last coordinator)
-- trusted_support_worker→support_worker

create or replace function public.demote_member(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id       uuid;
  v_org_type     text;
  v_caller_role  text;
  v_target_role  text;
  v_coord_count  int;
  v_new_role     text;
begin
  select org_id, role into v_org_id, v_caller_role
  from profiles where id = auth.uid();

  if v_caller_role != 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can demote members');
  end if;

  select role into v_target_role
  from profiles where id = p_user_id and org_id = v_org_id;

  if v_target_role is null then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  if v_target_role = 'coordinator' then
    select org_type into v_org_type from organisations where id = v_org_id;
    if v_org_type != 'family' then
      return json_build_object('ok', false, 'error', 'Coordinator demotion only applies in family organisations');
    end if;
    select count(*) into v_coord_count
    from profiles where org_id = v_org_id and role = 'coordinator';
    if v_coord_count <= 1 then
      return json_build_object('ok', false, 'error', 'Cannot demote the last coordinator');
    end if;
    v_new_role := 'family';
  elsif v_target_role = 'trusted_support_worker' then
    v_new_role := 'support_worker';
  else
    return json_build_object('ok', false, 'error', 'This role cannot be demoted');
  end if;

  update profiles set role = v_new_role where id = p_user_id and org_id = v_org_id;

  return json_build_object('ok', true, 'new_role', v_new_role);
end;
$$;

grant execute on function public.demote_member(uuid) to authenticated;

-- ── 12. remove_member RPC ────────────────────────────────────

create or replace function public.remove_member(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id       uuid;
  v_caller_role  text;
  v_target_role  text;
  v_coord_count  int;
begin
  select org_id, role into v_org_id, v_caller_role
  from profiles where id = auth.uid();

  if v_caller_role != 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can remove members');
  end if;

  if p_user_id = auth.uid() then
    select count(*) into v_coord_count
    from profiles where org_id = v_org_id and role = 'coordinator';
    if v_coord_count <= 1 then
      return json_build_object('ok', false, 'error', 'Cannot remove yourself — you are the only coordinator');
    end if;
  end if;

  select role into v_target_role
  from profiles where id = p_user_id and org_id = v_org_id;

  if v_target_role is null then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  -- Detach from org; reset to default coordinator role so they can sign up again
  update profiles set org_id = null, role = 'coordinator' where id = p_user_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.remove_member(uuid) to authenticated;

-- ── 13. get_org_members RPC ──────────────────────────────────

create or replace function public.get_org_members()
returns table (
  id        uuid,
  full_name text,
  role      text
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role
  from   profiles p
  where  p.org_id = public.my_org_id()
  order  by p.role, p.full_name;
$$;

grant execute on function public.get_org_members() to authenticated;
