-- ─────────────────────────────────────────────────────────────
-- 041 · Close the gaps blocking behaviour-note sharing from working
--
-- The behaviour_notes sharing feature (004) requires a client to
-- have a decision_maker_id, and a therapist to be `in_circle` for
-- that client — but nothing in the app ever set either of those.
-- Coordinators already have full UPDATE on clients (002), so no new
-- RLS is needed there; this just:
--   1. Lets accept_invite() actually add an accepted therapist to
--      client_circle (every other role already gets this treatment).
--   2. Adds a uniqueness constraint on client_circle so that insert
--      can safely use ON CONFLICT like client_workers/client_family.
-- ─────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'client_circle_client_therapist_key'
  ) then
    alter table client_circle
      add constraint client_circle_client_therapist_key unique (client_id, therapist_id);
  end if;
end $$;

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

  if lower(v_invite.email) != lower(v_email) then
    return json_build_object('error', 'invite_not_for_this_account');
  end if;

  update profiles
  set org_id = v_invite.org_id, role = v_invite.role
  where id = v_uid;

  if v_invite.client_id is not null then
    if v_invite.role = 'family' then
      insert into client_family (client_id, family_id, status)
      values (v_invite.client_id, v_uid, 'active')
      on conflict (client_id, family_id) do update set status = 'active';
    elsif v_invite.role in ('support_worker', 'trusted_support_worker') then
      insert into client_workers (client_id, worker_id)
      values (v_invite.client_id, v_uid)
      on conflict (client_id, worker_id) do nothing;
    elsif v_invite.role = 'recipient' then
      update clients set recipient_profile_id = v_uid where id = v_invite.client_id;
    elsif v_invite.role = 'therapist' then
      insert into client_circle (client_id, therapist_id, status)
      values (v_invite.client_id, v_uid, 'in_circle')
      on conflict (client_id, therapist_id) do update set status = 'in_circle';
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
