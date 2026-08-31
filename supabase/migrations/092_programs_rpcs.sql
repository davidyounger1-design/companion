-- 092_programs_rpcs.sql — program CRUD, participant/worker assignment, remove_member fix
--
-- Companion schema, SECURITY DEFINER, set search_path = 'companion','public',
-- org via public.my_org_id(), actor via public.my_role() — same two-check
-- shape as create_sub_role et al. (068): `if my_role() <> 'coordinator' then
-- raise exception 'forbidden'` first, then org_id = my_org_id() verified on
-- every id argument before any write. All idempotent (create or replace /
-- drop-then-recreate), schema-qualified throughout.

begin;

-- ── 1 · create_program ───────────────────────────────────────────────
create or replace function companion.create_program(
  p_name text, p_kind text, p_colour text default null
) returns uuid
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; v_id uuid;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  if v_org is null then raise exception 'forbidden'; end if;

  insert into companion.programs (org_id, name, kind, colour)
  values (v_org, btrim(p_name), p_kind, p_colour)
  returning id into v_id;

  return v_id;
end $$;

-- ── 2 · update_program ───────────────────────────────────────────────
create or replace function companion.update_program(
  p_id uuid, p_name text, p_kind text, p_colour text
) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  update companion.programs
    set name = btrim(p_name), kind = p_kind, colour = p_colour
    where id = p_id and org_id = public.my_org_id();

  if not found then raise exception 'program not found'; end if;
end $$;

-- ── 3 · archive_program ──────────────────────────────────────────────
-- Soft-deactivate only — programs is `active boolean`, no deleted_at; a
-- deactivated program keeps its history (participants/workers/shifts) intact.
create or replace function companion.archive_program(p_id uuid) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  update companion.programs set active = false
    where id = p_id and org_id = public.my_org_id();

  if not found then raise exception 'program not found'; end if;
end $$;

-- ── 4 · assign_participant_to_program / remove_participant_from_program ──
create or replace function companion.assign_participant_to_program(
  p_program_id uuid, p_participant_id uuid
) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();

  if not exists (select 1 from companion.programs where id = p_program_id and org_id = v_org) then
    raise exception 'program not found';
  end if;
  if not exists (select 1 from companion.clients where id = p_participant_id and org_id = v_org) then
    raise exception 'participant not found';
  end if;

  insert into companion.program_participants (program_id, participant_id, org_id)
  values (p_program_id, p_participant_id, v_org)
  on conflict (program_id, participant_id) do update set left_at = null;
end $$;

create or replace function companion.remove_participant_from_program(
  p_program_id uuid, p_participant_id uuid
) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  update companion.program_participants
    set left_at = now()
    where program_id = p_program_id and participant_id = p_participant_id
      and org_id = public.my_org_id() and left_at is null;

  if not found then raise exception 'assignment not found'; end if;
end $$;

-- ── 5 · assign_worker_to_program / remove_worker_from_program ────────
create or replace function companion.assign_worker_to_program(
  p_program_id uuid, p_worker_id uuid
) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();

  if not exists (select 1 from companion.programs where id = p_program_id and org_id = v_org) then
    raise exception 'program not found';
  end if;
  if not exists (select 1 from companion.profiles where id = p_worker_id and org_id = v_org) then
    raise exception 'worker not found';
  end if;

  insert into companion.program_workers (program_id, worker_id, org_id)
  values (p_program_id, p_worker_id, v_org)
  on conflict (program_id, worker_id) do update set removed_at = null;
end $$;

create or replace function companion.remove_worker_from_program(
  p_program_id uuid, p_worker_id uuid
) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  update companion.program_workers
    set removed_at = now()
    where program_id = p_program_id and worker_id = p_worker_id
      and org_id = public.my_org_id() and removed_at is null;

  if not found then raise exception 'assignment not found'; end if;
end $$;

-- ── 6 · remove_member — program-cleanup fix ──────────────────────────
-- remove_member (last rewritten in 069) deletes client_workers/client_family/
-- client_circle rows when detaching a member, but knows nothing about
-- programs. Without this, a removed member retains program-derived access to
-- their old org's participants via client_ids_for_worker()'s new union
-- (091 §5) — the exact hole 069 was written to close, reopened through the
-- new path. The org test in that union is the second line of defence, not a
-- substitute for this cleanup (091's function comment makes the same point).
--
-- Body otherwise identical to 069's version — only the two new deletes are
-- added, at the same point as the other membership-table cleanup.
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

  -- New: program-derived access cleanup (092).
  delete from companion.program_workers where worker_id = p_user_id;
  update companion.program_participants set left_at = now()
    where participant_id in (select id from companion.clients where recipient_profile_id = p_user_id)
      and left_at is null;

  update companion.profiles
    set org_id = null, sub_role_id = null
    where id = p_user_id;

  return json_build_object('ok', true);
end $$;

revoke all on function public.remove_member(uuid) from public, anon, authenticated;
revoke execute on function companion.remove_member(uuid) from public, anon;
grant  execute on function companion.remove_member(uuid) to authenticated;

-- Grants for the new functions above (Postgres grants EXECUTE to PUBLIC by default).
revoke execute on function
  companion.create_program(text, text, text),
  companion.update_program(uuid, text, text, text),
  companion.archive_program(uuid),
  companion.assign_participant_to_program(uuid, uuid),
  companion.remove_participant_from_program(uuid, uuid),
  companion.assign_worker_to_program(uuid, uuid),
  companion.remove_worker_from_program(uuid, uuid)
  from public, anon;

grant execute on function
  companion.create_program(text, text, text),
  companion.update_program(uuid, text, text, text),
  companion.archive_program(uuid),
  companion.assign_participant_to_program(uuid, uuid),
  companion.remove_participant_from_program(uuid, uuid),
  companion.assign_worker_to_program(uuid, uuid),
  companion.remove_worker_from_program(uuid, uuid)
  to authenticated;

commit;

-- ═══ POST-MIGRATION ASSERTIONS · all must return zero rows ═════════

-- A. Zero new functions that aren't SECURITY DEFINER with a pinned search_path.
select p.proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'companion'
  and p.proname in ('create_program','update_program','archive_program',
                     'assign_participant_to_program','remove_participant_from_program',
                     'assign_worker_to_program','remove_worker_from_program','remove_member')
  and (not p.prosecdef or p.proconfig is null);

-- B. remove_member still starts with the coordinator check (direct-API probe:
--    call as a non-coordinator, confirm {"ok":false,"error":"Only coordinators..."}).
