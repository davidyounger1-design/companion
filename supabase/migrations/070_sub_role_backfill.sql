-- ═══════════════════════════════════════════════════════════════════
-- 070 · Backfill. Creates each org's default sub-roles, migrates the
--       legacy org-wide overrides onto them, and creates + assigns a
--       named "Trusted worker" sub-role PER USER.
--
--       Confirmed 2026-08-23 via direct query: zero live profiles or
--       invites hold role = 'trusted_support_worker' (David checked the
--       database). Steps 3-6 below are the trusted-worker migration and
--       will therefore insert/update zero rows — kept in for
--       correctness/idempotence (a no-op costs nothing) rather than
--       hand-stripped, so this migration matches the reviewed original.
--
--       An org-wide write to org_settings.permissions -> 'support_worker'
--       -> invite_members would be STRICTLY WIDER than the status quo,
--       because that column is keyed by ROLE, not by user. A named
--       sub-role assigned per person gives exact per-user fidelity with
--       no org-wide widening.
--
--       Re-runnable: every insert is `where not exists`.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0 · PO DIAL D4 (moot given zero trusted rows, set for parity) ──
insert into companion.migration_gates (gate, note)
values ('po_assign_trusted', 'true')
on conflict (gate) do nothing;

-- ── 1 · Default sub-roles for every existing org ──────────────────
do $$
declare r record;
begin
  for r in select id from companion.organisations loop
    perform companion.ensure_default_sub_roles(r.id);
  end loop;
end $$;

-- ── 2 · Migrate legacy org-wide overrides onto the default sub-roles
--   Records ONLY values that DIFFER from role_permission_defaults.
--   This is what carries forward Sarah Younger's Care Circle's stored
--   org_settings.permissions overrides without freezing every
--   materialised default as if it were deliberate intent.
insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
select s.id, kv.key, (kv.value #>> '{}')::boolean and d.max_allowed
from   companion.org_settings os
cross  join lateral jsonb_each(coalesce(os.permissions,'{}'::jsonb)) as r(role_key, perms)
cross  join lateral jsonb_each(r.perms)                              as kv(key, value)
join   companion.sub_roles s
         on s.org_id = os.org_id and s.base_role = r.role_key
        and s.is_default and s.archived_at is null
join   companion.role_permission_defaults d
         on d.base_role = r.role_key and d.permission_key = kv.key
where  jsonb_typeof(kv.value) = 'boolean'
  and  ((kv.value #>> '{}')::boolean and d.max_allowed) is distinct from d.default_allowed
on conflict (sub_role_id, permission_key) do nothing;

-- ── 3 · The named "Trusted worker" sub-role, one per affected org ──
insert into companion.sub_roles (org_id, base_role, name, is_default)
select distinct o.id, 'support_worker', 'Trusted worker', false
from   companion.organisations o
where  (exists (select 1 from companion.profiles p
                 where p.org_id = o.id and p.role = 'trusted_support_worker')
     or exists (select 1 from companion.invites i
                 where i.org_id = o.id and i.role = 'trusted_support_worker'))
  and  not exists (select 1 from companion.sub_roles s
                    where s.org_id = o.id and s.base_role = 'support_worker'
                      and lower(btrim(s.name)) = 'trusted worker'
                      and s.archived_at is null);

-- ── 4 · Its permissions ─────────────────────────────────────────────
insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
select tw.id, d.permission_key,
       (coalesce(
          (os.permissions -> 'trusted_support_worker' ->> d.permission_key)::boolean,
          (os.permissions -> 'support_worker'         ->> d.permission_key)::boolean,
          d.default_allowed)
        or d.permission_key = 'invite_members')
       and d.max_allowed
from   companion.sub_roles tw
join   companion.role_permission_defaults d on d.base_role = 'support_worker'
left   join companion.org_settings os on os.org_id = tw.org_id
where  tw.base_role = 'support_worker'
  and  lower(btrim(tw.name)) = 'trusted worker'
  and  tw.archived_at is null
  and  ((coalesce(
            (os.permissions -> 'trusted_support_worker' ->> d.permission_key)::boolean,
            (os.permissions -> 'support_worker'         ->> d.permission_key)::boolean,
            d.default_allowed)
          or d.permission_key = 'invite_members')
        and d.max_allowed) is distinct from d.default_allowed
on conflict (sub_role_id, permission_key) do nothing;

-- ── 5 · Its invite BREADTH: exactly ['support_worker'] ─────────────
insert into companion.sub_role_invitable_roles (sub_role_id, invitable_role)
select tw.id, 'support_worker'
from   companion.sub_roles tw
where  tw.base_role = 'support_worker'
  and  lower(btrim(tw.name)) = 'trusted worker'
  and  tw.archived_at is null
on conflict do nothing;

-- ── 6 · Assign, PER USER, via a transitional trusted-flavoured twin ─
insert into companion.sub_roles (org_id, base_role, name, is_default)
select distinct p.org_id, 'trusted_support_worker', 'Trusted worker (migrating)', false
from   companion.profiles p
where  p.role = 'trusted_support_worker' and p.org_id is not null
  and  not exists (select 1 from companion.sub_roles s
                    where s.org_id = p.org_id
                      and s.base_role = 'trusted_support_worker');

insert into companion.sub_roles (org_id, base_role, name, is_default)
select distinct i.org_id, 'trusted_support_worker', 'Trusted worker (migrating)', false
from   companion.invites i
where  i.role = 'trusted_support_worker'
  and  not exists (select 1 from companion.sub_roles s
                    where s.org_id = i.org_id
                      and s.base_role = 'trusted_support_worker');

update companion.profiles p
   set sub_role_id = s.id
from companion.sub_roles s
where s.org_id = p.org_id
  and s.base_role = 'trusted_support_worker'
  and p.role = 'trusted_support_worker'
  and p.sub_role_id is null
  and (select note from companion.migration_gates where gate = 'po_assign_trusted') = 'true';

update companion.invites i
   set sub_role_id = s.id
from companion.sub_roles s
where s.org_id = i.org_id
  and s.base_role = 'trusted_support_worker'
  and i.role = 'trusted_support_worker'
  and i.sub_role_id is null;

-- ── 7 · Every non-trusted member gets their org's default sub-role ─
update companion.profiles p
   set sub_role_id = s.id
from companion.sub_roles s
where s.org_id = p.org_id and s.base_role = p.role
  and s.is_default and s.archived_at is null
  and p.sub_role_id is null and p.org_id is not null;

-- ── 8 · ASSERT. Fail loudly rather than half-apply. ────────────────
do $$
declare n_p bigint; n_i bigint; n_tw bigint;
begin
  if (select note from companion.migration_gates where gate = 'po_assign_trusted') = 'true' then
    select count(*) into n_p from companion.profiles
     where role = 'trusted_support_worker' and sub_role_id is null and org_id is not null;
    if n_p > 0 then
      raise exception 'Backfill incomplete: % trusted profile(s) unassigned', n_p;
    end if;
  end if;

  select count(*) into n_i from companion.invites
   where role = 'trusted_support_worker' and sub_role_id is null;
  if n_i > 0 then
    raise exception 'Backfill incomplete: % trusted invite(s) unassigned', n_i;
  end if;

  select count(*) into n_tw from companion.sub_roles
   where base_role = 'support_worker' and lower(btrim(name)) = 'trusted worker';
  raise notice 'Created/found % "Trusted worker" sub-role(s)', n_tw;
end $$;

commit;

-- ── POST-070 VERIFICATION. Run and eyeball: every row for Sarah
--    Younger's Care Circle should show the same permission values it
--    had before (has_perm_overrides = true), now resolved through the
--    new function instead of the old jsonb column. ─────────────────
select p.id, p.full_name, p.role, o.name as org_name,
       companion.permissions_for(p.id) as resolved_perms
from   companion.profiles p
join   companion.organisations o on o.id = p.org_id
where  o.name = 'Sarah Younger''s Care Circle'
order  by p.role, p.full_name;
