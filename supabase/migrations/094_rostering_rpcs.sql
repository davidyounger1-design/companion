-- 094_rostering_rpcs.sql — rostering RPCs (status machine, job board, templates)
--
-- Design: docs/superpowers/specs/2026-08-24-rostering-design.md §3/§5.1.
-- Every RPC: SECURITY DEFINER, set search_path = 'companion','public', org via
-- public.my_org_id(), actor via public.my_role()/auth.uid(). Every RPC begins
-- with the `org_has_feature('rostering')` gate — SECURITY DEFINER bypasses
-- RLS, so this guard is the only thing stopping a downgraded org's direct RPC
-- calls (074's fail-closed idiom). Transitions are conditional UPDATEs
-- (`where id = X and status = <legal from>`; affected-rows 0 = invalid
-- transition) — never check-then-write.

begin;

-- ── 1 · rostering_create_shift ───────────────────────────────────────
create or replace function companion.rostering_create_shift(
  p_program_id uuid, p_worker_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_participant_ids uuid[], p_notes text default null, p_override_note text default null
) returns uuid
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; v_id uuid; p uuid;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  if v_org is null then raise exception 'forbidden'; end if;

  if not exists (select 1 from companion.programs where id = p_program_id and org_id = v_org) then
    raise exception 'program not found';
  end if;
  if p_worker_id is not null and not exists (
    select 1 from companion.program_workers
    where program_id = p_program_id and worker_id = p_worker_id and removed_at is null and org_id = v_org
  ) then
    raise exception 'worker does not staff this program';
  end if;
  foreach p in array coalesce(p_participant_ids, '{}') loop
    if not exists (
      select 1 from companion.program_participants
      where program_id = p_program_id and participant_id = p and left_at is null and org_id = v_org
    ) then
      raise exception 'participant is not in this program';
    end if;
  end loop;

  if p_worker_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_worker_id::text, 0));
    if (p_override_note is null or btrim(p_override_note) = '') and exists (
      select 1 from companion.shifts
      where worker_id = p_worker_id and deleted_at is null and status not in ('cancelled','completed')
        and starts_at < p_ends_at and ends_at > p_starts_at
    ) then
      raise exception 'shift overlaps an existing shift for this worker';
    end if;
  end if;

  insert into companion.shifts (org_id, program_id, worker_id, is_open, starts_at, ends_at, notes, override_note, created_by)
  values (v_org, p_program_id, p_worker_id, p_worker_id is null, p_starts_at, p_ends_at, p_notes, p_override_note, auth.uid())
  returning id into v_id;

  foreach p in array coalesce(p_participant_ids, '{}') loop
    insert into companion.shift_participants (shift_id, participant_id, org_id) values (v_id, p, v_org);
  end loop;

  return v_id;
end $$;

-- ── 2 · rostering_update_shift — draft-only schedule edits ───────────
create or replace function companion.rostering_update_shift(
  p_shift_id uuid, p_worker_id uuid, p_starts_at timestamptz, p_ends_at timestamptz,
  p_participant_ids uuid[], p_notes text default null, p_override_note text default null
) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; v_program uuid; v_status text; p uuid;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();

  select program_id, status into v_program, v_status
    from companion.shifts where id = p_shift_id and org_id = v_org and deleted_at is null;
  if v_program is null then raise exception 'shift not found'; end if;
  if v_status <> 'draft' then raise exception 'schedule edits only allowed while draft'; end if;

  if p_worker_id is not null and not exists (
    select 1 from companion.program_workers
    where program_id = v_program and worker_id = p_worker_id and removed_at is null and org_id = v_org
  ) then
    raise exception 'worker does not staff this program';
  end if;
  foreach p in array coalesce(p_participant_ids, '{}') loop
    if not exists (
      select 1 from companion.program_participants
      where program_id = v_program and participant_id = p and left_at is null and org_id = v_org
    ) then
      raise exception 'participant is not in this program';
    end if;
  end loop;

  if p_worker_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_worker_id::text, 0));
    if (p_override_note is null or btrim(p_override_note) = '') and exists (
      select 1 from companion.shifts
      where worker_id = p_worker_id and deleted_at is null and status not in ('cancelled','completed')
        and id <> p_shift_id
        and starts_at < p_ends_at and ends_at > p_starts_at
    ) then
      raise exception 'shift overlaps an existing shift for this worker';
    end if;
  end if;

  update companion.shifts
    set worker_id = p_worker_id, is_open = (p_worker_id is null), starts_at = p_starts_at, ends_at = p_ends_at,
        notes = p_notes, override_note = p_override_note, updated_at = now()
    where id = p_shift_id and status = 'draft';
  if not found then raise exception 'invalid transition'; end if;

  delete from companion.shift_participants where shift_id = p_shift_id;
  foreach p in array coalesce(p_participant_ids, '{}') loop
    insert into companion.shift_participants (shift_id, participant_id, org_id) values (p_shift_id, p, v_org);
  end loop;
end $$;

-- ── 3 · rostering_delete_shift — soft-delete, draft/published/confirmed only ──
create or replace function companion.rostering_delete_shift(p_shift_id uuid) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  update companion.shifts
    set deleted_at = now()
    where id = p_shift_id and org_id = public.my_org_id() and deleted_at is null
      and status in ('draft','published','confirmed');
  if not found then raise exception 'invalid transition'; end if;
end $$;

-- ── 4 · rostering_publish_shift — draft→published; 095's trigger notifies ──
create or replace function companion.rostering_publish_shift(p_shift_id uuid) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  update companion.shifts
    set status = 'published', updated_at = now()
    where id = p_shift_id and org_id = public.my_org_id() and deleted_at is null and status = 'draft';
  if not found then raise exception 'invalid transition'; end if;
end $$;

-- ── 5 · rostering_cancel_shift ───────────────────────────────────────
create or replace function companion.rostering_cancel_shift(p_shift_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  update companion.shifts
    set status = 'cancelled', notes = p_reason, updated_at = now()
    where id = p_shift_id and org_id = public.my_org_id() and deleted_at is null
      and status in ('draft','published','confirmed');
  if not found then raise exception 'invalid transition'; end if;
end $$;

-- ── 6 · rostering_confirm_shift ──────────────────────────────────────
create or replace function companion.rostering_confirm_shift(p_shift_id uuid) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;

  update companion.shifts
    set status = 'confirmed', updated_at = now()
    where id = p_shift_id and worker_id = auth.uid() and deleted_at is null and status = 'published';
  if not found then raise exception 'invalid transition'; end if;
end $$;

-- ── 7 · rostering_claim_shift — job-board claim, published(open)→confirmed ──
create or replace function companion.rostering_claim_shift(p_shift_id uuid) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_program uuid; v_starts timestamptz; v_ends timestamptz; v_org uuid;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;

  select program_id, starts_at, ends_at, org_id into v_program, v_starts, v_ends, v_org
    from companion.shifts
    where id = p_shift_id and is_open and status = 'published' and deleted_at is null;
  if v_program is null then raise exception 'shift not available'; end if;

  if not exists (
    select 1 from companion.program_workers
    where program_id = v_program and worker_id = auth.uid() and removed_at is null and org_id = v_org
  ) then
    raise exception 'you do not staff this program';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  if exists (
    select 1 from companion.shifts
    where worker_id = auth.uid() and deleted_at is null and status not in ('cancelled','completed')
      and id <> p_shift_id
      and starts_at < v_ends and ends_at > v_starts
  ) then
    raise exception 'shift overlaps an existing shift for you';
  end if;

  update companion.shifts
    set worker_id = auth.uid(), is_open = false, status = 'confirmed', updated_at = now()
    where id = p_shift_id and is_open and status = 'published';
  if not found then raise exception 'invalid transition'; end if;
end $$;

-- ── 8 · rostering_start_shift — start window, §3 ─────────────────────
create or replace function companion.rostering_start_shift(p_shift_id uuid) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_starts timestamptz; v_ends timestamptz;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;

  select starts_at, ends_at into v_starts, v_ends from companion.shifts
    where id = p_shift_id and worker_id = auth.uid() and deleted_at is null
      and status in ('published','confirmed');
  if v_starts is null then raise exception 'invalid transition'; end if;

  if now() < greatest(v_starts - interval '2 hours', date_trunc('day', v_starts)) or now() > v_ends then
    raise exception 'outside the allowed start window for this shift';
  end if;

  update companion.shifts
    set status = 'in_progress', updated_at = now()
    where id = p_shift_id and worker_id = auth.uid() and status in ('published','confirmed');
  if not found then raise exception 'invalid transition'; end if;
end $$;

-- ── 9 · rostering_end_shift — writes the handover in the same tx ─────
create or replace function companion.rostering_end_shift(
  p_shift_id uuid, p_handover_body text default null, p_nothing_to_hand_over boolean default false
) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_worker uuid; v_actor uuid := auth.uid(); v_body_empty boolean;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;

  select worker_id into v_worker from companion.shifts
    where id = p_shift_id and deleted_at is null and status = 'in_progress';
  if v_worker is null then raise exception 'invalid transition'; end if;

  -- Assigned worker ends their own shift; coordinator force-end (DECISION Q-A,
  -- Option 1) breaks the author-is-worker invariant deliberately.
  if v_actor <> v_worker and public.my_role() <> 'coordinator' then
    raise exception 'forbidden';
  end if;

  v_body_empty := (p_handover_body is null or btrim(p_handover_body) = '');
  if v_body_empty <> p_nothing_to_hand_over then
    raise exception 'provide a handover note or mark nothing to hand over, not both or neither';
  end if;

  update companion.shifts
    set status = 'completed', updated_at = now()
    where id = p_shift_id and status = 'in_progress';
  if not found then raise exception 'invalid transition'; end if;

  insert into companion.shift_handovers (shift_id, author_id, body, nothing_to_hand_over)
  values (p_shift_id, v_actor, nullif(btrim(p_handover_body), ''), p_nothing_to_hand_over);
end $$;

-- ── 10 · rostering_copy_forward ──────────────────────────────────────
create or replace function companion.rostering_copy_forward(p_source_week date, p_target_week date)
returns jsonb
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; r record; v_shift_diff interval; v_new_start timestamptz; v_new_end timestamptz;
        v_new_id uuid; v_created int := 0; v_skipped int := 0;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  v_shift_diff := (p_target_week - p_source_week) * interval '1 day';

  for r in
    select * from companion.shifts
    where org_id = v_org and deleted_at is null
      and status in ('draft','published','confirmed')
      and starts_at >= p_source_week and starts_at < p_source_week + interval '7 days'
  loop
    if r.worker_id is not null and not exists (
      select 1 from companion.program_workers
      where program_id = r.program_id and worker_id = r.worker_id and removed_at is null and org_id = v_org
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_new_start := r.starts_at + v_shift_diff;
    v_new_end   := r.ends_at   + v_shift_diff;

    if r.worker_id is not null then
      perform pg_advisory_xact_lock(hashtextextended(r.worker_id::text, 0));
      if exists (
        select 1 from companion.shifts
        where worker_id = r.worker_id and deleted_at is null and status not in ('cancelled','completed')
          and starts_at < v_new_end and ends_at > v_new_start
      ) then
        v_skipped := v_skipped + 1;
        continue;
      end if;
    end if;

    insert into companion.shifts (org_id, program_id, worker_id, is_open, required_skills, starts_at, ends_at, notes, created_by)
    values (v_org, r.program_id, r.worker_id, r.is_open, r.required_skills, v_new_start, v_new_end, r.notes, auth.uid())
    returning id into v_new_id;

    insert into companion.shift_participants (shift_id, participant_id, org_id)
    select v_new_id, sp.participant_id, v_org from companion.shift_participants sp
    where sp.shift_id = r.id and sp.left_at is null;

    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped', v_skipped);
end $$;

-- ── 11 · rostering_week_grid ──────────────────────────────────────────
create or replace function companion.rostering_week_grid(p_week_start date, p_program_id uuid)
returns jsonb
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; result jsonb;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();

  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) into result
  from (
    select s.id, s.worker_id, pr.full_name as worker_name, s.is_open, s.status,
           s.starts_at, s.ends_at, s.required_skills, s.notes, s.template_id,
           (select jsonb_agg(jsonb_build_object('id', c.id, 'full_name', c.full_name))
              from companion.shift_participants sp
              join companion.clients c on c.id = sp.participant_id
              where sp.shift_id = s.id and sp.left_at is null) as participants
    from companion.shifts s
    left join companion.profiles pr on pr.id = s.worker_id
    where s.org_id = v_org and s.program_id = p_program_id and s.deleted_at is null
      and s.starts_at >= p_week_start and s.starts_at < p_week_start + interval '7 days'
    order by s.starts_at
  ) x;

  return result;
end $$;

-- ── 12 · rostering_warnings — W1 overlap, W2 no cover, W3 unconfirmed ──
create or replace function companion.rostering_warnings(p_week_start date, p_program_id uuid)
returns jsonb
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; v_overlaps jsonb; v_uncovered jsonb; v_unconfirmed jsonb;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();

  select coalesce(jsonb_agg(jsonb_build_object('worker_id', a.worker_id, 'shift_a', a.id, 'shift_b', b.id)), '[]'::jsonb)
    into v_overlaps
  from companion.shifts a
  join companion.shifts b on b.worker_id = a.worker_id and b.id > a.id
  where a.org_id = v_org and a.program_id = p_program_id and b.org_id = v_org and b.program_id = p_program_id
    and a.deleted_at is null and b.deleted_at is null and a.worker_id is not null
    and a.status not in ('cancelled','completed') and b.status not in ('cancelled','completed')
    and a.starts_at < b.ends_at and a.ends_at > b.starts_at
    and a.starts_at >= p_week_start and a.starts_at < p_week_start + interval '7 days';

  select coalesce(jsonb_agg(jsonb_build_object('participant_id', pp.participant_id, 'day', d::date)), '[]'::jsonb)
    into v_uncovered
  from companion.program_participants pp
  cross join generate_series(p_week_start, p_week_start + interval '6 days', interval '1 day') as d
  where pp.program_id = p_program_id and pp.org_id = v_org and pp.left_at is null
    and not exists (
      select 1 from companion.shifts s
      join companion.shift_participants sp on sp.shift_id = s.id
      where sp.participant_id = pp.participant_id and sp.left_at is null
        and s.program_id = p_program_id and s.deleted_at is null and s.status not in ('cancelled','completed')
        and s.starts_at::date = d::date
    );

  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'starts_at', s.starts_at)), '[]'::jsonb)
    into v_unconfirmed
  from companion.shifts s
  where s.org_id = v_org and s.program_id = p_program_id and s.deleted_at is null
    and s.status = 'published' and not s.is_open
    and s.starts_at >= p_week_start and s.starts_at < p_week_start + interval '7 days';

  return jsonb_build_object('overlaps', v_overlaps, 'uncovered', v_uncovered, 'unconfirmed', v_unconfirmed);
end $$;

-- ── 13 · rostering_previous_handover ──────────────────────────────────
create or replace function companion.rostering_previous_handover(
  p_program_id uuid, p_participant_ids uuid[], p_before timestamptz
) returns jsonb
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare result jsonb; v_fallback boolean := false;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if not exists (
    select 1 from companion.program_workers
    where program_id = p_program_id and worker_id = auth.uid() and removed_at is null and org_id = public.my_org_id()
  ) then
    raise exception 'you do not staff this program';
  end if;

  select to_jsonb(h) into result
  from companion.shift_handovers h
  join companion.shifts s on s.id = h.shift_id
  join companion.shift_participants sp on sp.shift_id = s.id
    and sp.participant_id = any(coalesce(p_participant_ids, '{}')) and sp.left_at is null
  where s.program_id = p_program_id and s.status = 'completed' and s.starts_at < p_before
  order by h.created_at desc limit 1;

  if result is null then
    v_fallback := true;
    select to_jsonb(h) into result
    from companion.shift_handovers h
    join companion.shifts s on s.id = h.shift_id
    where s.program_id = p_program_id and s.status = 'completed' and s.starts_at < p_before
    order by h.created_at desc limit 1;
  end if;

  if result is null then return null; end if;
  return result || jsonb_build_object('fallback_no_shared_participants', v_fallback);
end $$;

-- ── 14 · rostering_set_availability — replace-all ────────────────────
create or replace function companion.rostering_set_availability(p_days jsonb) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; d jsonb;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  v_org := public.my_org_id();
  if v_org is null then raise exception 'forbidden'; end if;

  delete from companion.worker_availability where worker_id = auth.uid();

  for d in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) loop
    insert into companion.worker_availability (worker_id, org_id, day_of_week, starts_time, ends_time)
    values (auth.uid(), v_org, (d->>'day_of_week')::int, (d->>'starts_time')::time, (d->>'ends_time')::time);
  end loop;
end $$;

-- ── 15 · rostering_set_skills — replace-all ──────────────────────────
create or replace function companion.rostering_set_skills(p_skills text[]) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; s text;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  v_org := public.my_org_id();
  if v_org is null then raise exception 'forbidden'; end if;

  delete from companion.profile_skills where profile_id = auth.uid();

  foreach s in array coalesce(p_skills, '{}') loop
    insert into companion.profile_skills (profile_id, org_id, skill) values (auth.uid(), v_org, btrim(s))
    on conflict (profile_id, skill) do nothing;
  end loop;
end $$;

-- ── 16 · shift-template CRUD ──────────────────────────────────────────
create or replace function companion.rostering_create_template(
  p_program_id uuid, p_worker_id uuid, p_day_of_week int, p_starts_time time, p_ends_time time,
  p_end_date date, p_participant_ids uuid[]
) returns uuid
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; v_id uuid; p uuid;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();

  if not exists (
    select 1 from companion.program_workers
    where program_id = p_program_id and worker_id = p_worker_id and removed_at is null and org_id = v_org
  ) then
    raise exception 'worker does not staff this program';
  end if;
  foreach p in array coalesce(p_participant_ids, '{}') loop
    if not exists (
      select 1 from companion.program_participants
      where program_id = p_program_id and participant_id = p and left_at is null and org_id = v_org
    ) then
      raise exception 'participant is not in this program';
    end if;
  end loop;

  insert into companion.shift_templates (org_id, program_id, worker_id, day_of_week, starts_time, ends_time, end_date, participant_ids)
  values (v_org, p_program_id, p_worker_id, p_day_of_week, p_starts_time, p_ends_time, p_end_date, coalesce(p_participant_ids, '{}'))
  returning id into v_id;

  return v_id;
end $$;

create or replace function companion.rostering_update_template(
  p_id uuid, p_worker_id uuid, p_day_of_week int, p_starts_time time, p_ends_time time,
  p_end_date date, p_participant_ids uuid[]
) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
declare v_org uuid; v_program uuid; p uuid;
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();

  select program_id into v_program from companion.shift_templates where id = p_id and org_id = v_org;
  if v_program is null then raise exception 'template not found'; end if;

  if not exists (
    select 1 from companion.program_workers
    where program_id = v_program and worker_id = p_worker_id and removed_at is null and org_id = v_org
  ) then
    raise exception 'worker does not staff this program';
  end if;
  foreach p in array coalesce(p_participant_ids, '{}') loop
    if not exists (
      select 1 from companion.program_participants
      where program_id = v_program and participant_id = p and left_at is null and org_id = v_org
    ) then
      raise exception 'participant is not in this program';
    end if;
  end loop;

  update companion.shift_templates
    set worker_id = p_worker_id, day_of_week = p_day_of_week, starts_time = p_starts_time,
        ends_time = p_ends_time, end_date = p_end_date, participant_ids = coalesce(p_participant_ids, '{}')
    where id = p_id;
end $$;

create or replace function companion.rostering_pause_template(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  update companion.shift_templates set active = p_active
    where id = p_id and org_id = public.my_org_id();
  if not found then raise exception 'template not found'; end if;
end $$;

create or replace function companion.rostering_delete_template(p_id uuid) returns void
language plpgsql security definer set search_path = 'companion', 'public' as $$
begin
  if not public.org_has_feature('rostering') then raise exception 'rostering not included in plan'; end if;
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;

  delete from companion.shift_templates where id = p_id and org_id = public.my_org_id();
  if not found then raise exception 'template not found'; end if;
end $$;

-- ── 17 · remove_member — rostering refusal (extends 092's version) ───
-- Adds a check BEFORE the 092 program/client detach logic: a member with any
-- future *assigned* shift (worker_id or created_by), or who authored a
-- handover on a shift that somehow isn't completed (structurally shouldn't
-- happen — rostering_end_shift writes both atomically — kept as a defensive
-- check per the design doc), cannot be removed. Applies to assigned rows
-- only: an open (unassigned) shift never blocks a departure.
create or replace function companion.remove_member(p_user_id uuid)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare v_org_id uuid; v_caller_role text; v_target_role text; v_coord_count int; v_blocking_count int;
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

  select count(*) into v_blocking_count
  from companion.shifts s
  where s.deleted_at is null
    and s.starts_at >= now() and s.status not in ('cancelled','completed')
    and (s.worker_id = p_user_id or s.created_by = p_user_id);
  if v_blocking_count > 0 then
    return json_build_object('ok', false, 'error',
      'This member has upcoming shifts (assigned or created). Reassign or cancel them first.');
  end if;

  select count(*) into v_blocking_count
  from companion.shift_handovers h
  join companion.shifts s on s.id = h.shift_id
  where h.author_id = p_user_id and s.status <> 'completed';
  if v_blocking_count > 0 then
    return json_build_object('ok', false, 'error',
      'This member authored a handover on a shift that is not yet completed.');
  end if;

  delete from companion.client_workers where worker_id  = p_user_id;
  delete from companion.client_family  where family_id  = p_user_id;
  delete from companion.client_circle  where therapist_id = p_user_id;
  update companion.clients set recipient_profile_id = null
    where recipient_profile_id = p_user_id;
  update companion.clients set decision_maker_id = null
    where decision_maker_id = p_user_id;

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

-- Grants for every rostering RPC above (Postgres grants EXECUTE to PUBLIC by default).
revoke execute on function
  companion.rostering_create_shift(uuid, uuid, timestamptz, timestamptz, uuid[], text, text),
  companion.rostering_update_shift(uuid, uuid, timestamptz, timestamptz, uuid[], text, text),
  companion.rostering_delete_shift(uuid),
  companion.rostering_publish_shift(uuid),
  companion.rostering_cancel_shift(uuid, text),
  companion.rostering_confirm_shift(uuid),
  companion.rostering_claim_shift(uuid),
  companion.rostering_start_shift(uuid),
  companion.rostering_end_shift(uuid, text, boolean),
  companion.rostering_copy_forward(date, date),
  companion.rostering_week_grid(date, uuid),
  companion.rostering_warnings(date, uuid),
  companion.rostering_previous_handover(uuid, uuid[], timestamptz),
  companion.rostering_set_availability(jsonb),
  companion.rostering_set_skills(text[]),
  companion.rostering_create_template(uuid, uuid, int, time, time, date, uuid[]),
  companion.rostering_update_template(uuid, uuid, int, time, time, date, uuid[]),
  companion.rostering_pause_template(uuid, boolean),
  companion.rostering_delete_template(uuid)
  from public, anon;

grant execute on function
  companion.rostering_create_shift(uuid, uuid, timestamptz, timestamptz, uuid[], text, text),
  companion.rostering_update_shift(uuid, uuid, timestamptz, timestamptz, uuid[], text, text),
  companion.rostering_delete_shift(uuid),
  companion.rostering_publish_shift(uuid),
  companion.rostering_cancel_shift(uuid, text),
  companion.rostering_confirm_shift(uuid),
  companion.rostering_claim_shift(uuid),
  companion.rostering_start_shift(uuid),
  companion.rostering_end_shift(uuid, text, boolean),
  companion.rostering_copy_forward(date, date),
  companion.rostering_week_grid(date, uuid),
  companion.rostering_warnings(date, uuid),
  companion.rostering_previous_handover(uuid, uuid[], timestamptz),
  companion.rostering_set_availability(jsonb),
  companion.rostering_set_skills(text[]),
  companion.rostering_create_template(uuid, uuid, int, time, time, date, uuid[]),
  companion.rostering_update_template(uuid, uuid, int, time, time, date, uuid[]),
  companion.rostering_pause_template(uuid, boolean),
  companion.rostering_delete_template(uuid)
  to authenticated;

commit;

-- ═══ POST-MIGRATION ASSERTIONS ═══════════════════════════════════════
-- A. Direct-API probes (per 076/084 practice, on freshly-created test orgs):
--    - org without `rostering`: every RPC above raises 'rostering not
--      included in plan', for both coordinator and worker callers.
--    - overlap create without override fails; with override succeeds.
--    - two concurrent rostering_create_shift calls for one worker cannot
--      both land (advisory lock serializes them; the second re-checks and
--      fails the overlap test).
--    - rostering_claim_shift on a non-open or non-published shift fails;
--      on an open+published shift in a program the caller doesn't staff
--      fails with 'you do not staff this program'.
--    - remove_member on a worker with a future assigned shift returns
--      {"ok":false,...}; on a worker with only open (unassigned) shifts in
--      their former programs succeeds (open shifts never block).
