-- ─────────────────────────────────────────────────────────────
-- 010 · Invite RPCs   (idempotent)
-- Provides SECURITY DEFINER functions so anon users can look up
-- an invite by token, and authenticated users can accept one.
-- ─────────────────────────────────────────────────────────────

create or replace function public.lookup_invite(p_token text)
returns table (
  org_id     uuid,
  org_name   text,
  email      text,
  role       text,
  expires_at timestamptz,
  status     text
)
language sql
security definer
set search_path = public
as $$
  select i.org_id, o.name as org_name, i.email, i.role, i.expires_at, i.status
  from   invites i
  join   organisations o on o.id = i.org_id
  where  i.token = p_token
  limit  1;
$$;

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
  set    org_id = v_invite.org_id,
         role   = v_invite.role
  where  id = v_uid;

  update invites set status = 'accepted' where id = v_invite.id;

  return json_build_object(
    'ok',     true,
    'role',   v_invite.role,
    'org_id', v_invite.org_id::text
  );
end;
$$;

grant execute on function public.lookup_invite(text) to anon, authenticated;
grant execute on function public.accept_invite(text) to authenticated;
