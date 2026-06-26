-- ─────────────────────────────────────────────────────────────
-- 014 · Fix setup_family_org: creator should be coordinator, not family
--
-- Bug: migration 011 set role = 'family' for the org creator.
-- A coordinator who created the family org was then blocked from
-- inviting members (403 Forbidden from invite-member edge function).
-- ─────────────────────────────────────────────────────────────

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

  insert into organisations (id, name, plan, billing_status, org_type)
  values (v_org_id, p_participant_name || '''s Care Circle', 'family', 'trial', 'family');

  insert into org_settings (org_id) values (v_org_id);

  -- Creator is the coordinator, not a family-role member
  update profiles set org_id = v_org_id, role = 'coordinator' where id = v_uid;

  insert into clients (id, org_id, full_name, active)
  values (v_client_id, v_org_id, p_participant_name, true);

  insert into client_family (client_id, family_id, relationship, status)
  values (v_client_id, v_uid, 'primary_carer', 'active');

  return json_build_object('ok', true, 'org_id', v_org_id, 'client_id', v_client_id);
end;
$$;

grant execute on function public.setup_family_org(text) to authenticated;

-- Fix existing orgs created before org_type column existed (migration 011)
update organisations set org_type = 'family' where plan = 'family' and org_type is null;

-- Fix any existing accounts created with the wrong role
-- (coordinator-intent users who got role='family' from migration 011)
-- Uses plan='family' so it works even if org_type was previously null.
update profiles p
set role = 'coordinator'
from organisations o
where p.org_id = o.id
  and o.plan = 'family'
  and p.role = 'family'
  and exists (
    select 1 from client_family cf
    where cf.family_id = p.id
      and cf.relationship = 'primary_carer'
  );
