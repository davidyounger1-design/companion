-- ─────────────────────────────────────────────────────────────
-- 055 · Server-side participant seat enforcement (idempotent)
-- The seat cap for participant-metered plans was previously enforced only
-- in the browser (Step4Clients.tsx) — bypassable via a slow network (the
-- check hadn't loaded yet), multiple tabs, or calling the Supabase API
-- directly with a valid session. This adds the real backstop: seats/
-- metered_axis are mirrored onto organisations (kept in sync by
-- reconcileOrgPlan on login) and a trigger blocks INSERT/reactivation on
-- clients once the org is at its seat limit.
-- ─────────────────────────────────────────────────────────────

alter table organisations add column if not exists seats integer;
alter table organisations add column if not exists metered_axis text check (metered_axis in ('workers','participants'));

create or replace function enforce_participant_seats() returns trigger as $$
declare
  v_seats  integer;
  v_axis   text;
  v_active integer;
begin
  select seats, metered_axis into v_seats, v_axis
  from organisations where id = new.org_id;

  if v_axis = 'participants' and v_seats is not null then
    select count(*) into v_active from clients where org_id = new.org_id and active = true;
    if v_active >= v_seats then
      raise exception 'Participant seat limit reached: this plan allows % active participant(s)', v_seats
        using errcode = 'P0001', hint = 'PARTICIPANT_SEAT_LIMIT_REACHED';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists clients_enforce_seats_insert on clients;
create trigger clients_enforce_seats_insert
  before insert on clients
  for each row execute function enforce_participant_seats();

-- Also guard reactivating a previously-inactive participant, which would
-- otherwise be an easy way around the insert-time check.
drop trigger if exists clients_enforce_seats_reactivate on clients;
create trigger clients_enforce_seats_reactivate
  before update of active on clients
  for each row
  when (new.active = true and old.active is distinct from true)
  execute function enforce_participant_seats();
