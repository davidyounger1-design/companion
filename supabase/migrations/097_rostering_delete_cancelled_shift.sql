-- ═══════════════════════════════════════════════════════════════════
-- 097 · Allow deleting a cancelled shift
--       (idempotent)
--
-- rostering_delete_shift only ever allowed 'draft','published','confirmed'
-- — a cancelled shift had no way to be removed at all, from the UI or the
-- RPC. Cancelling was designed as a real terminal state (kept as a record,
-- same idea as the app never letting a completed log entry be deleted),
-- but a coordinator who cancelled a shift by mistake, or wants a test/
-- one-off cancelled shift off the board, had no path to clear it.
--
-- THE FIX: widen the status list to also allow 'cancelled'. Still a soft
-- delete (deleted_at, never a hard delete), still coordinator-only, still
-- org-scoped — nothing else about the function changes.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · Live body of the function this migration replaces. Read it before
--      replacing it — never work from a remembered body.
select pg_get_functiondef(oid) from pg_proc
where  proname = 'rostering_delete_shift' and pronamespace = 'companion'::regnamespace;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

create or replace function companion.rostering_delete_shift(p_shift_id uuid) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  update companion.shifts
    set deleted_at = now()
    where id = p_shift_id and org_id = public.my_org_id() and deleted_at is null
      and status in ('draft','published','confirmed','cancelled');
  if not found then raise exception 'invalid transition'; end if;
end $$;

-- Grant unchanged: create or replace preserves the existing grants (this
-- function's signature doesn't change), so no revoke/grant lines needed.

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · Structural — the status list now includes 'cancelled'.
select pg_get_functiondef(oid) like '%''cancelled''%' as allows_cancelled
from   pg_proc
where  proname = 'rostering_delete_shift' and pronamespace = 'companion'::regnamespace;
-- ^ must be true.

-- V2 · Grants unchanged — still authenticated only.
select r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_execute
from   pg_proc p
join   pg_namespace n on n.oid = p.pronamespace
cross  join (select oid, rolname from pg_roles where rolname in ('anon','authenticated')) r
where  n.nspname = 'companion' and p.proname = 'rostering_delete_shift'
order  by r.rolname;

-- V3 · Behavioural — a cancelled shift can now be soft-deleted; an already
--      soft-deleted or already-completed/in_progress shift still cannot.
--      Runs as a real profile via the JWT-claims GUC, same pattern as
--      098's own probe elsewhere in this migration set. Cleans up fully.
do $$
declare
  v_org      uuid;
  v_program  uuid;
  v_profile  uuid;
  v_shift_ok uuid;
  v_shift_bad uuid;
  v_deleted  timestamptz;
begin
  select id into v_profile from companion.profiles where role = 'coordinator' limit 1;
  if v_profile is null then
    raise notice 'V3 SKIPPED: no coordinator profile to run the probe as';
    return;
  end if;
  select org_id into v_org from companion.profiles where id = v_profile;
  select id into v_program from companion.programs where org_id = v_org limit 1;
  if v_program is null then
    raise notice 'V3 SKIPPED: coordinator''s org has no program to attach a test shift to';
    return;
  end if;

  insert into companion.shifts (org_id, program_id, status, starts_at, ends_at, created_by)
  values (v_org, v_program, 'cancelled', now(), now() + interval '1 hour', v_profile)
  returning id into v_shift_ok;

  insert into companion.shifts (org_id, program_id, status, starts_at, ends_at, created_by)
  values (v_org, v_program, 'completed', now(), now() + interval '1 hour', v_profile)
  returning id into v_shift_bad;

  perform set_config('request.jwt.claims', json_build_object('sub', v_profile)::text, true);

  perform companion.rostering_delete_shift(v_shift_ok);
  select deleted_at into v_deleted from companion.shifts where id = v_shift_ok;
  if v_deleted is null then
    raise exception 'V3 FAILED: cancelled shift was not soft-deleted';
  end if;

  begin
    perform companion.rostering_delete_shift(v_shift_bad);
    raise exception 'V3 FAILED: a completed shift was deletable — it must not be';
  exception
    when others then
      if sqlerrm <> 'invalid transition' then raise; end if;
  end;

  delete from companion.shifts where id in (v_shift_ok, v_shift_bad);

  raise notice 'V3 PASSED: cancelled shift deletable, completed shift still refused; test rows cleaned up';
end $$;
