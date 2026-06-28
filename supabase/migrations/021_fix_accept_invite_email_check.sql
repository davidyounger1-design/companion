-- ─────────────────────────────────────────────────────────────
-- 021 · Fix accept_invite — verify invite email matches caller
--
-- Bug: accept_invite never checked that the invite was for the
-- currently-signed-in user's email. Any authenticated user who
-- had a pending invite token (e.g. a test link, or a link opened
-- while already logged in) would have their role silently
-- overwritten — including coordinators being downgraded to family.
-- ─────────────────────────────────────────────────────────────

create or replace function public.accept_invite(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite   invites%rowtype;
  v_uid      uuid := auth.uid();
  v_email    text := auth.email();
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

  -- Guard: only accept if the invite was sent to THIS user's email.
  -- Without this check a coordinator who opened a family-member invite
  -- link while logged in would have their role silently downgraded.
  if lower(v_invite.email) != lower(v_email) then
    return json_build_object('error', 'invite_not_for_this_account');
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
