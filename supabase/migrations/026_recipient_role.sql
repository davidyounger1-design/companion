-- ─────────────────────────────────────────────────────────────
-- 026 · Recipient role + client_feedback   (idempotent)
--
-- Adds a 'recipient' role: the person being cared for gets their
-- own login, linked 1:1 to their existing `clients` row via
-- clients.recipient_profile_id (mirrors decision_maker_id).
--
-- They can view and add rows in a new `client_feedback` table —
-- self-authored feedback about their own care, visible to their
-- circle (coordinator, family, assigned workers, circle therapists)
-- but only ever written by the recipient themselves.
--
-- Onboarding reuses the existing invite flow (accept_invite /
-- redeem-invite), linking the accepting user to invites.client_id.
-- ─────────────────────────────────────────────────────────────

-- ── 1. Add 'recipient' to role constraints ───────────────────

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
  check (role in ('coordinator','support_worker','family','therapist','trusted_support_worker','recipient'));

alter table invites drop constraint if exists invites_role_check;
alter table invites
  add constraint invites_role_check
  check (role in ('coordinator','support_worker','family','therapist','trusted_support_worker','recipient'));

-- ── 2. Link a recipient's profile to their own client record ─

alter table clients
  add column if not exists recipient_profile_id uuid references profiles(id) on delete set null;

create or replace function public.client_ids_for_recipient()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from clients where recipient_profile_id = auth.uid()
$$;

grant execute on function public.client_ids_for_recipient() to authenticated;

-- Direct column check on clients itself — no subquery, so no recursion risk.
drop policy if exists "recipient can view own client record" on clients;

create policy "recipient can view own client record"
  on clients for select
  using (recipient_profile_id = auth.uid());

-- ── 3. client_feedback table ──────────────────────────────────

create table if not exists client_feedback (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients(id) on delete cascade,
  org_id     uuid not null references organisations(id) on delete cascade,
  author_id  uuid not null references profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

alter table client_feedback enable row level security;

drop policy if exists "recipient can view own feedback"              on client_feedback;
drop policy if exists "recipient can add own feedback"                on client_feedback;
drop policy if exists "coordinators can view org feedback"            on client_feedback;
drop policy if exists "family can view feedback for their clients"    on client_feedback;
drop policy if exists "workers can view feedback for assigned clients" on client_feedback;
drop policy if exists "therapists can view feedback for circle clients" on client_feedback;

create policy "recipient can view own feedback"
  on client_feedback for select
  using (client_id in (select public.client_ids_for_recipient()));

create policy "recipient can add own feedback"
  on client_feedback for insert
  with check (
    author_id = auth.uid()
    and public.my_role() = 'recipient'
    and client_id in (select public.client_ids_for_recipient())
  );

create policy "coordinators can view org feedback"
  on client_feedback for select
  using (
    org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
  );

create policy "family can view feedback for their clients"
  on client_feedback for select
  using (client_id in (select public.client_ids_for_family()));

create policy "workers can view feedback for assigned clients"
  on client_feedback for select
  using (client_id in (select public.client_ids_for_worker()));

create policy "therapists can view feedback for circle clients"
  on client_feedback for select
  using (client_id in (select public.client_ids_for_therapist()));

-- ── 4. accept_invite: link recipient_profile_id on accept ────
-- (based on 021's version — keeps the email-match guard, adds recipient branch)

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
