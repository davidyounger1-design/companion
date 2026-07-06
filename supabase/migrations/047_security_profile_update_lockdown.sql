-- ─────────────────────────────────────────────────────────────
-- 047 · CRITICAL security fix — stop self privilege-escalation via profiles
--
-- The `profiles` UPDATE policy (001) is `using (id = auth.uid())` with no
-- WITH CHECK and no column restriction, so any authenticated user could
--   update profiles set role='coordinator', org_id='<any-org>' where id=auth.uid()
-- and instantly become coordinator of their own OR any other org — full
-- cross-tenant access to behaviour notes, journals, messages, clients.
--
-- Fix: column-level UPDATE privileges. Regular users may only change their
-- own full_name and phone. role/org_id are changed exclusively by the
-- SECURITY DEFINER RPCs (accept_invite, promote_member, demote_member,
-- remove_member) and by service-role edge functions — both of which run as
-- the function owner / service role and are unaffected by these grants.
--
-- The one legitimate user-driven org_id write was createOrganisation() in
-- the app, which self-set org_id during setup. That is replaced by the
-- create_organisation() RPC below, which refuses to run if the caller is
-- already in an org (so it can't be used to hop into someone else's org).
-- ─────────────────────────────────────────────────────────────

-- The row-scoping policy stays; column privileges are the new control.
revoke update on public.profiles from authenticated;
grant  update (full_name, phone) on public.profiles to authenticated;

-- Belt-and-braces: also forbid a row from changing owner via UPDATE (the
-- USING clause already pins id = auth.uid(); this makes the intent explicit).
drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ── Org creation as a vetted RPC (replaces the direct org_id self-update) ──
create or replace function public.create_organisation(
  p_name     text,
  p_state    text,
  p_services  text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_current_org uuid;
  v_org_id      uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  -- Can't create/join a new org while already a member of one — this is what
  -- prevents the RPC from being repurposed to jump into another org.
  select org_id into v_current_org from profiles where id = v_uid;
  if v_current_org is not null then
    raise exception 'already_in_org';
  end if;

  insert into organisations (name, state, services, plan, billing_status)
  values (p_name, p_state, coalesce(p_services, '{}'), 'trial', 'trial')
  returning id into v_org_id;

  update profiles set org_id = v_org_id, role = 'coordinator' where id = v_uid;

  insert into org_settings (org_id) values (v_org_id);

  return v_org_id;
end;
$$;

grant execute on function public.create_organisation(text, text, text[]) to authenticated;
