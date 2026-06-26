-- ─────────────────────────────────────────────────────────────
-- 011 · Family plan support   (idempotent)
-- ─────────────────────────────────────────────────────────────

-- ── 1. Fix support_worker log visibility: own entries only ───

drop policy if exists "workers can view logs for assigned clients"  on log_entries;
drop policy if exists "workers can view own log entries"           on log_entries;

create policy "workers can view own log entries"
  on log_entries for select
  using (
    public.my_role() = 'support_worker'
    and author_id = auth.uid()
  );

-- ── 2. Family members can insert log entries ─────────────────

drop policy if exists "family can log for their participant" on log_entries;

create policy "family can log for their participant"
  on log_entries for insert
  with check (
    public.my_role() = 'family'
    and author_id = auth.uid()
    and org_id = public.my_org_id()
    and client_id in (
      select client_id from client_family
      where family_id = auth.uid() and status = 'active'
    )
  );

-- ── 3. Family can manage clients in their org ────────────────
-- (needed to create the participant during onboarding)

drop policy if exists "family can manage clients in org" on clients;

create policy "family can manage clients in org"
  on clients for all
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'family'
  );

-- ── 4. Family can manage client_family links ─────────────────

drop policy if exists "family can manage client_family" on client_family;

create policy "family can manage client_family"
  on client_family for all
  using (
    client_id in (
      select id from clients where org_id = public.my_org_id()
    )
    and public.my_role() = 'family'
  );

-- ── 5. Family can manage client_workers (assign support workers) ──

drop policy if exists "family can manage client_workers" on client_workers;

create policy "family can manage client_workers"
  on client_workers for all
  using (
    client_id in (
      select id from clients where org_id = public.my_org_id()
    )
    and public.my_role() = 'family'
  );

-- ── 6. Family can manage invites ─────────────────────────────

drop policy if exists "family can manage invites" on invites;

create policy "family can manage invites"
  on invites for all
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'family'
  );

-- ── 7. setup_family_org RPC ──────────────────────────────────
-- Atomic, security-definer setup: creates org + org_settings +
-- updates profile role + creates participant + links creator.

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

  insert into organisations (id, name, plan, billing_status)
  values (v_org_id, p_participant_name || '''s Care Circle', 'family', 'trial');

  insert into org_settings (org_id) values (v_org_id);

  update profiles set org_id = v_org_id, role = 'family' where id = v_uid;

  insert into clients (id, org_id, full_name, active)
  values (v_client_id, v_org_id, p_participant_name, true);

  insert into client_family (client_id, family_id, relationship, status)
  values (v_client_id, v_uid, 'primary_carer', 'active');

  return json_build_object('ok', true, 'org_id', v_org_id, 'client_id', v_client_id);
end;
$$;

grant execute on function public.setup_family_org(text) to authenticated;

-- ── 8. Update accept_invite to link client tables ────────────

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

  -- Link to participant when client_id is present on the invite
  if v_invite.client_id is not null then
    if v_invite.role = 'family' then
      insert into client_family (client_id, family_id, status)
      values (v_invite.client_id, v_uid, 'active')
      on conflict (client_id, family_id) do update set status = 'active';
    elsif v_invite.role = 'support_worker' then
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

-- ── 9. Storage bucket for journal photos ─────────────────────
-- Path format: {org_id}/{client_id}/{user_id}/{uuid}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'journal-photos',
  'journal-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif']
)
on conflict (id) do nothing;

drop policy if exists "authenticated can upload journal photos"        on storage.objects;
drop policy if exists "family and coordinators can view all journal photos" on storage.objects;
drop policy if exists "workers can view own journal photos"            on storage.objects;

create policy "authenticated can upload journal photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'journal-photos'
    and public.my_org_id() is not null
  );

-- Family/coordinator can see all photos in their org's folder (first path segment = org_id)
create policy "family and coordinators can view all journal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-photos'
    and public.my_role() in ('family', 'coordinator')
    and (string_to_array(name, '/'))[1] = public.my_org_id()::text
  );

-- Workers can only see photos they uploaded (third path segment = user_id)
create policy "workers can view own journal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-photos'
    and public.my_role() = 'support_worker'
    and (string_to_array(name, '/'))[3] = auth.uid()::text
  );
