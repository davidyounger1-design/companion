-- ─────────────────────────────────────────────────────────────
-- 049 · Let a coordinator edit any member's details
--
-- The profiles UPDATE policy is `id = auth.uid()` (a user can only edit
-- their own row) and 047 further restricted the editable columns — so a
-- coordinator has no direct path to fix another member's name or phone.
-- This adds a SECURITY DEFINER RPC that a coordinator can use to update
-- any member IN THEIR OWN ORG, and extends get_org_members to return the
-- phone so the edit form can prefill it.
--
-- Name/phone are not privilege-sensitive, so any target member is allowed
-- (role changes still go through promote_member/demote_member, which keep
-- their own guards). Email changes are an auth operation and are out of
-- scope here.
-- ─────────────────────────────────────────────────────────────

drop function if exists public.get_org_members();

create function public.get_org_members()
returns table (
  id        uuid,
  full_name text,
  role      text,
  email     text,
  phone     text
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role, u.email, p.phone
  from   profiles p
  join   auth.users u on u.id = p.id
  where  p.org_id = public.my_org_id()
  order  by p.role, p.full_name;
$$;

grant execute on function public.get_org_members() to authenticated;

create or replace function public.update_member(
  p_user_id   uuid,
  p_full_name text,
  p_phone     text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id      uuid;
  v_caller_role text;
begin
  select org_id, role into v_org_id, v_caller_role
  from profiles where id = auth.uid();

  if v_caller_role != 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can edit members');
  end if;

  if coalesce(trim(p_full_name), '') = '' then
    return json_build_object('ok', false, 'error', 'Name is required');
  end if;

  -- Target must be in the caller's org.
  if not exists (select 1 from profiles where id = p_user_id and org_id = v_org_id) then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  update profiles
  set full_name = trim(p_full_name),
      phone     = nullif(trim(p_phone), '')
  where id = p_user_id;

  return json_build_object('ok', true);
end;
$$;

grant execute on function public.update_member(uuid, text, text) to authenticated;
