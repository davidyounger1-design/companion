-- ═══════════════════════════════════════════════════════════════════
-- 068 · Sub-role & permission-resolution infrastructure  (idempotent)
--
-- ADDITIVE ONLY. Creates the vocabulary, the sub-role tables, the
-- resolution functions and the management RPCs. Changes NO existing
-- policy, NO existing constraint, and NO existing row. Nothing in the
-- app reads any of it yet.
--
-- Every table is schema-qualified `companion.*`; every function pins
-- `search_path = ''` and fully qualifies every reference, so an
-- unqualified name errors loudly instead of resolving through whatever
-- happens to be visible. (This repo has been bitten twice: 062 failed
-- because the SQL editor's search_path is `public`; 060 needed a regex
-- fallback for client_ids_for_recipient()'s bare `from clients`.)
--
-- RLS + explicit grants are NOT optional here. 060:54 sets
--   alter default privileges in schema companion
--     grant select, insert, update, delete on tables to authenticated;
-- so a bare `create table` in this schema is world-writable, and
-- Postgres grants EXECUTE on new functions to PUBLIC by default.
--
-- PO decisions locked for this rollout (David, 2026-08-23):
--   D1  ceiling_sw_edit_any_entry   = false
--   D2  sub_roles_allowed           = support_worker only
--   D3  ceiling_sw_view_all_entries = true (default stays false)
--   D4  po_assign_trusted           = true (moot: zero live trusted rows)
--   D5  n/a — dropped, not needed (only one org has stored overrides
--       and it is honoured as-is by construction, see 070 step 2)
-- ═══════════════════════════════════════════════════════════════════

begin;

create table if not exists companion.migration_gates (
  gate     text primary key,
  noted_at timestamptz not null default now(),
  note     text
);
alter table companion.migration_gates enable row level security;
revoke all on table companion.migration_gates from anon, authenticated;

-- ═══ 1 · CATALOGUE: base roles ═════════════════════════════════════
create table if not exists companion.base_roles (
  role              text primary key,
  label             text    not null,
  sub_roles_allowed boolean not null default false,
  is_transitional   boolean not null default false,
  sort_order        int     not null default 0
);

insert into companion.base_roles (role, label, sub_roles_allowed, is_transitional, sort_order) values
  ('coordinator',            'Coordinator',    false, false, 10),
  ('family',                 'Family member',  false, false, 20),
  ('recipient',              'Care recipient', false, false, 30),
  ('support_worker',         'Support worker',  true, false, 40),
  ('therapist',              'Therapist',      false, false, 50),
  -- TRANSITIONAL. Exists only so 070 can point a still-'trusted' profile
  -- at a sub-role without violating the composite FK, and so the invite
  -- ceiling can keep serving those users until 071 flips them.
  -- Removed in the cleanup migration.
  ('trusted_support_worker', 'Trusted worker', false,  true, 45)
on conflict (role) do update
  set label = excluded.label,
      sub_roles_allowed = excluded.sub_roles_allowed,
      is_transitional   = excluded.is_transitional,
      sort_order        = excluded.sort_order;

-- ═══ 2 · CATALOGUE: the permission vocabulary ══════════════════════
-- kind:
--   'gate'  — can only NARROW an existing capability. Enforced by a
--             RESTRICTIVE policy, which Postgres ANDs against the
--             OR-union of all permissive policies, so it can only ever
--             remove rows. A gate toggle physically cannot widen scope.
--   'grant' — ADMITS rows the base role otherwise cannot reach.
--             Enforced by a PERMISSIVE policy whose structural ceiling
--             term (an assignment table) is unconditional.
create table if not exists companion.permission_keys (
  key          text primary key,
  label        text not null,
  description  text,
  kind         text not null check (kind in ('gate','grant')),
  target_table text not null,
  target_cmd   text not null check (target_cmd in ('SELECT','INSERT','UPDATE','DELETE')),
  enforced     boolean not null default false,   -- flipped true when its policy ships
  sort_order   int not null default 0
);

insert into companion.permission_keys
  (key, label, description, kind, target_table, target_cmd, sort_order) values
  ('add_entries',      'Add journal entries',      'Can log new meal, activity, mood and note entries',        'gate',  'log_entries',      'INSERT', 10),
  ('view_all_entries', 'View all entries',         'Can see entries logged by other team members for the participants they are assigned to', 'grant', 'log_entries', 'SELECT', 20),
  ('edit_own_entry',   'Edit own entries',         'Can edit entries they personally logged',                   'gate',  'log_entries',      'UPDATE', 30),
  ('edit_any_entry',   'Edit anyone''s entries',   'Can edit entries logged by any team member',                'grant', 'log_entries',      'UPDATE', 40),
  ('delete_own_entry', 'Delete own entries',       'Can delete entries they personally logged',                 'gate',  'log_entries',      'DELETE', 50),
  ('send_messages',    'Send messages',            'Can send direct messages to other members',                 'gate',  'messages',         'INSERT', 60),
  ('invite_members',   'Invite members',           'Can send invitations, for the roles their sub-role allows',  'grant', 'invites',          'INSERT', 70),
  ('add_goals',        'Add goals',                'Can set a new NDIS goal for a connected participant',       'gate',  'participant_goals','INSERT', 80),
  ('edit_own_goal',    'Edit own goals',           'Can edit or discontinue a goal they created',               'gate',  'participant_goals','UPDATE', 90),
  ('edit_any_goal',    'Edit anyone''s goals',     'Can edit or discontinue a goal created by any team member',  'grant', 'participant_goals','UPDATE', 100),
  ('delete_own_goal',  'Delete own goals',         'Can delete a goal they created',                            'gate',  'participant_goals','DELETE', 110)
on conflict (key) do update
  set label = excluded.label, description = excluded.description,
      kind  = excluded.kind,  target_table = excluded.target_table,
      target_cmd = excluded.target_cmd, sort_order = excluded.sort_order;

-- ═══ 3 · CATALOGUE: defaults + ceilings ════════════════════════════
-- default_allowed = what a sub-role starts at / falls back to.
--                   Seeded to DEFAULT_PERMS in usePermissions.ts EXACTLY,
--                   plus the two new delete keys seeded to exactly what
--                   live RLS already permits (023, 058, 067) — day-one
--                   no-ops.
-- max_allowed     = the CEILING. No sub-role of this base role may
--                   exceed it. Clamped at READ time AND at write time.
create table if not exists companion.role_permission_defaults (
  base_role       text    not null references companion.base_roles(role)      on delete cascade,
  permission_key  text    not null references companion.permission_keys(key)  on delete cascade,
  default_allowed boolean not null,
  max_allowed     boolean not null,
  primary key (base_role, permission_key),
  constraint rpd_default_within_ceiling check (max_allowed or not default_allowed)
);

insert into companion.role_permission_defaults
  (base_role, permission_key, default_allowed, max_allowed) values
  -- coordinator: short-circuited in resolution, seeded for completeness only
  ('coordinator','add_entries',      true, true), ('coordinator','view_all_entries', true, true),
  ('coordinator','edit_own_entry',   true, true), ('coordinator','edit_any_entry',   true, true),
  ('coordinator','delete_own_entry', true, true), ('coordinator','send_messages',    true, true),
  ('coordinator','invite_members',   true, true), ('coordinator','add_goals',        true, true),
  ('coordinator','edit_own_goal',    true, true), ('coordinator','edit_any_goal',    true, true),
  ('coordinator','delete_own_goal',  true, true),
  -- family
  ('family','add_entries',      true, true), ('family','view_all_entries', true, true),
  ('family','edit_own_entry',   true, true), ('family','edit_any_entry',   true, true),
  ('family','delete_own_entry', true, true), ('family','send_messages',    true, true),
  ('family','invite_members',   true, true), ('family','add_goals',        true, true),
  ('family','edit_own_goal',    true, true), ('family','edit_any_goal',    true, true),
  ('family','delete_own_goal',  true, true),
  -- support_worker  ── the ceilings that matter (D1, D3)
  ('support_worker','add_entries',      true,  true),
  ('support_worker','view_all_entries', false, true),   -- D3: grantable, off by default
  ('support_worker','edit_own_entry',   true,  true),
  ('support_worker','edit_any_entry',   false, false),  -- D1: hard no
  ('support_worker','delete_own_entry', true,  true),
  ('support_worker','send_messages',    true,  true),
  ('support_worker','invite_members',   false, true),   -- what makes "Trusted worker" expressible
  ('support_worker','add_goals',        true,  true),
  ('support_worker','edit_own_goal',    true,  true),
  ('support_worker','edit_any_goal',    false, true),
  ('support_worker','delete_own_goal',  true,  true),
  -- therapist: ceilings == defaults (no sub-roles, D2)
  ('therapist','add_entries',      false,false), ('therapist','view_all_entries', true, true),
  ('therapist','edit_own_entry',   false,false), ('therapist','edit_any_entry',   false,false),
  ('therapist','delete_own_entry', false,false), ('therapist','send_messages',    true, true),
  ('therapist','invite_members',   false,false), ('therapist','add_goals',        true, true),
  ('therapist','edit_own_goal',    true, true),  ('therapist','edit_any_goal',    false,false),
  ('therapist','delete_own_goal',  true, true),
  -- recipient: ceilings == defaults
  ('recipient','add_entries',      true, true),  ('recipient','view_all_entries', true, true),
  ('recipient','edit_own_entry',   true, true),  ('recipient','edit_any_entry',   false,false),
  ('recipient','delete_own_entry', true, true),  ('recipient','send_messages',    false,false),
  ('recipient','invite_members',   false,false), ('recipient','add_goals',        true, true),
  ('recipient','edit_own_goal',    true, true),  ('recipient','edit_any_goal',    false,false),
  ('recipient','delete_own_goal',  true, true),
  -- TRANSITIONAL trusted_support_worker: byte-identical to support_worker
  -- except invite_members. Removed in cleanup.
  ('trusted_support_worker','add_entries',      true,  true),
  ('trusted_support_worker','view_all_entries', false, true),
  ('trusted_support_worker','edit_own_entry',   true,  true),
  ('trusted_support_worker','edit_any_entry',   false, false),
  ('trusted_support_worker','delete_own_entry', true,  true),
  ('trusted_support_worker','send_messages',    true,  true),
  ('trusted_support_worker','invite_members',   true,  true),
  ('trusted_support_worker','add_goals',        true,  true),
  ('trusted_support_worker','edit_own_goal',    true,  true),
  ('trusted_support_worker','edit_any_goal',    false, true),
  ('trusted_support_worker','delete_own_goal',  true,  true)
on conflict (base_role, permission_key) do update
  set default_allowed = excluded.default_allowed,
      max_allowed     = excluded.max_allowed;

-- ═══ 4 · CATALOGUE: invite ceiling ═════════════════════════════════
-- The CEILING, not the grant. Seeded to exactly the backend's current
-- behaviour (invite-member/index.ts INVITE_MATRIX) which has NO
-- support_worker key at all: a plain worker with invite_members ON has
-- always received a 403. The `support_worker` row below is a CEILING
-- ONLY. The actual grant is companion.sub_role_invitable_roles, which is
-- EMPTY for every default sub-role, so no plain worker gains anything
-- even in an org where a coordinator ticked `invite_members` on.
create table if not exists companion.invite_ceiling (
  caller_base_role text not null references companion.base_roles(role) on delete cascade,
  invitable_role   text not null references companion.base_roles(role) on delete cascade,
  primary key (caller_base_role, invitable_role)
);

-- NOTE: no ('coordinator'|'family', 'trusted_support_worker') rows. A
-- coordinator's invitable-role check short-circuits to the FULL ceiling
-- (companion.invitable_roles_for's `p.role = 'coordinator' or exists(...)`
-- branch), so any such row would make 'Trusted worker' reappear as a
-- directly-invitable ROLE in the invite dropdown — exactly the path this
-- migration exists to retire in favour of a support_worker sub-role.
-- Confirmed live 2026-08-23: seeding it, even as "transitional", made it
-- show up in the deployed app's invite modal immediately.
insert into companion.invite_ceiling (caller_base_role, invitable_role) values
  ('coordinator','coordinator'),  ('coordinator','family'),
  ('coordinator','recipient'),    ('coordinator','support_worker'),
  ('coordinator','therapist'),
  ('family','family'),            ('family','recipient'),
  ('family','support_worker'),    ('family','therapist'),
  ('trusted_support_worker','support_worker'),                              -- transitional, moot (zero live rows)
  ('support_worker','support_worker')            -- CEILING ONLY, see comment above
on conflict do nothing;

-- ═══ 5 · SUB-ROLES ═════════════════════════════════════════════════
create table if not exists companion.sub_roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references companion.organisations(id) on delete cascade,
  base_role   text not null references companion.base_roles(role),
  name        text not null,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_by  uuid references companion.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A coordinator sub-role is forbidden: resolution short-circuits on
  -- coordinator in many code sites, and a restricted coordinator can
  -- lock an org out of its own settings page.
  constraint sub_roles_no_coordinator check (base_role <> 'coordinator'),
  constraint sub_roles_name_len       check (char_length(btrim(name)) between 1 and 40),
  -- Makes the composite FK possible: closes cross-tenant AND
  -- cross-base-role assignment declaratively, not by RPC discipline.
  constraint sub_roles_id_org_role_uk unique (id, org_id, base_role)
);

create unique index if not exists sub_roles_org_role_name_uk
  on companion.sub_roles (org_id, base_role, lower(btrim(name))) where archived_at is null;
create unique index if not exists sub_roles_one_default_uk
  on companion.sub_roles (org_id, base_role) where is_default;
create index if not exists sub_roles_org_role_idx
  on companion.sub_roles (org_id, base_role) where archived_at is null;

create table if not exists companion.sub_role_permissions (
  sub_role_id    uuid    not null references companion.sub_roles(id)         on delete cascade,
  permission_key text    not null references companion.permission_keys(key)  on delete cascade,
  allowed        boolean not null,
  primary key (sub_role_id, permission_key)
);

create table if not exists companion.sub_role_invitable_roles (
  sub_role_id    uuid not null references companion.sub_roles(id)      on delete cascade,
  invitable_role text not null references companion.base_roles(role)   on delete cascade,
  primary key (sub_role_id, invitable_role)
);

-- ═══ 6 · profiles / invites reference columns + composite FKs ══════
alter table companion.profiles add column if not exists sub_role_id uuid;
alter table companion.invites  add column if not exists sub_role_id uuid;

create index if not exists profiles_sub_role_idx on companion.profiles (sub_role_id);
create index if not exists invites_sub_role_idx  on companion.invites  (sub_role_id);

-- NOT VALID: no existing row has a non-null sub_role_id, so there is
-- nothing to scan, and 069 (which fixes every writer) VALIDATEs them.
--   * ON DELETE RESTRICT, not SET NULL: multi-column SET NULL nulls
--     EVERY referencing column — it would wipe org_id and role off the
--     profile.
--   * ON UPDATE RESTRICT, not CASCADE: multi-column cascade would
--     propagate an UPDATE of sub_roles.org_id into profiles.org_id and
--     of base_role into profiles.role — a one-statement cross-tenant
--     move or self-promotion. Both columns are immutable by trigger, so
--     there is no legitimate cascade.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'profiles_sub_role_fk'
                   and conrelid = 'companion.profiles'::regclass) then
    alter table companion.profiles
      add constraint profiles_sub_role_fk
      foreign key (sub_role_id, org_id, role)
      references companion.sub_roles (id, org_id, base_role)
      on delete restrict on update restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'invites_sub_role_fk'
                   and conrelid = 'companion.invites'::regclass) then
    alter table companion.invites
      add constraint invites_sub_role_fk
      foreign key (sub_role_id, org_id, role)
      references companion.sub_roles (id, org_id, base_role)
      on delete restrict on update restrict not valid;
  end if;
end $$;

-- NOTE, deliberately not fixed by a grant: sub_role_id is RPC-only.
-- 047 revoked column UPDATE for `authenticated` and granted only
-- (full_name, phone). There is no `grant update (sub_role_id) ...`
-- anywhere in this migration, and there must never be one.

-- ═══ 7 · RLS + GRANTS · load-bearing, see header ═══════════════════
alter table companion.base_roles               enable row level security;
alter table companion.permission_keys          enable row level security;
alter table companion.role_permission_defaults enable row level security;
alter table companion.invite_ceiling           enable row level security;
alter table companion.sub_roles                enable row level security;
alter table companion.sub_role_permissions     enable row level security;
alter table companion.sub_role_invitable_roles enable row level security;

revoke all on table companion.base_roles,
                    companion.permission_keys,
                    companion.role_permission_defaults,
                    companion.invite_ceiling,
                    companion.sub_roles,
                    companion.sub_role_permissions,
                    companion.sub_role_invitable_roles
  from anon, authenticated;

-- Catalogues: read-only to signed-in users (the settings UI is built
-- from them). No INSERT/UPDATE/DELETE grant at all.
grant select on companion.base_roles,
                companion.permission_keys,
                companion.role_permission_defaults,
                companion.invite_ceiling
  to authenticated;

-- Sub-role rows: read within your own org only. Writes are RPC-only.
grant select on companion.sub_roles,
                companion.sub_role_permissions,
                companion.sub_role_invitable_roles
  to authenticated;

drop policy if exists "catalogue readable"  on companion.base_roles;
drop policy if exists "catalogue readable"  on companion.permission_keys;
drop policy if exists "catalogue readable"  on companion.role_permission_defaults;
drop policy if exists "catalogue readable"  on companion.invite_ceiling;
create policy "catalogue readable" on companion.base_roles               for select to authenticated using (true);
create policy "catalogue readable" on companion.permission_keys          for select to authenticated using (true);
create policy "catalogue readable" on companion.role_permission_defaults for select to authenticated using (true);
create policy "catalogue readable" on companion.invite_ceiling           for select to authenticated using (true);

drop policy if exists "own org sub-roles readable" on companion.sub_roles;
create policy "own org sub-roles readable"
  on companion.sub_roles for select to authenticated
  using (org_id = public.my_org_id());

drop policy if exists "own org sub-role perms readable" on companion.sub_role_permissions;
create policy "own org sub-role perms readable"
  on companion.sub_role_permissions for select to authenticated
  using (exists (select 1 from companion.sub_roles s
                 where s.id = sub_role_id and s.org_id = public.my_org_id()));

drop policy if exists "own org sub-role invites readable" on companion.sub_role_invitable_roles;
create policy "own org sub-role invites readable"
  on companion.sub_role_invitable_roles for select to authenticated
  using (exists (select 1 from companion.sub_roles s
                 where s.id = sub_role_id and s.org_id = public.my_org_id()));

-- ═══ 8 · TRIGGERS · the mechanisms the columns claim to be ═════════

-- 8a · org_id and base_role are IMMUTABLE. The unique constraint only
--      makes the composite FK possible; it does not stop an UPDATE.
create or replace function companion.tg_sub_roles_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'sub_roles.org_id is immutable';
  end if;
  if new.base_role is distinct from old.base_role then
    raise exception 'sub_roles.base_role is immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sub_roles_immutable on companion.sub_roles;
create trigger sub_roles_immutable before update on companion.sub_roles
  for each row execute function companion.tg_sub_roles_immutable();

-- 8b · base_roles.sub_roles_allowed is ENFORCED, not documentation.
create or replace function companion.tg_sub_roles_allowed()
returns trigger language plpgsql set search_path = '' as $$
declare v_ok boolean;
begin
  select b.sub_roles_allowed into v_ok
  from companion.base_roles b where b.role = new.base_role;
  if not coalesce(v_ok, false) then
    raise exception 'sub-roles are not enabled for base role %', new.base_role;
  end if;
  return new;
end $$;
drop trigger if exists sub_roles_allowed_check on companion.sub_roles;
create trigger sub_roles_allowed_check before insert on companion.sub_roles
  for each row execute function companion.tg_sub_roles_allowed();

-- 8c · CEILING enforced at WRITE time (it is also enforced at READ time
--      in permissions_for, which is the half that holds even for rows
--      written by hand or by a service-role edge function).
create or replace function companion.tg_sub_role_perm_ceiling()
returns trigger language plpgsql set search_path = '' as $$
declare v_max boolean;
begin
  select d.max_allowed into v_max
  from companion.role_permission_defaults d
  join companion.sub_roles s on s.id = new.sub_role_id
  where d.base_role = s.base_role and d.permission_key = new.permission_key;
  if v_max is null then
    raise exception 'permission % is not defined for this sub-role''s base role', new.permission_key;
  end if;
  if new.allowed and not v_max then
    raise exception 'permission % exceeds the ceiling for this base role', new.permission_key;
  end if;
  return new;
end $$;
drop trigger if exists sub_role_perm_ceiling on companion.sub_role_permissions;
create trigger sub_role_perm_ceiling before insert or update on companion.sub_role_permissions
  for each row execute function companion.tg_sub_role_perm_ceiling();

-- 8d · invitable roles clamped to invite_ceiling[base_role].
create or replace function companion.tg_sub_role_invitable_ceiling()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from companion.sub_roles s
    join companion.invite_ceiling ic on ic.caller_base_role = s.base_role
    where s.id = new.sub_role_id and ic.invitable_role = new.invitable_role
  ) then
    raise exception 'role % is above the invite ceiling for this sub-role', new.invitable_role;
  end if;
  return new;
end $$;
drop trigger if exists sub_role_invitable_ceiling on companion.sub_role_invitable_roles;
create trigger sub_role_invitable_ceiling before insert or update on companion.sub_role_invitable_roles
  for each row execute function companion.tg_sub_role_invitable_ceiling();

-- 8e · Org deletion. organisations→sub_roles is CASCADE but
--      organisations→profiles.org_id is SET NULL, so without this the
--      cascade would hit profiles_sub_role_fk's RESTRICT and deleting an
--      organisation would fail. Detach the pointers first.
create or replace function companion.tg_org_detach_sub_roles()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update companion.profiles set sub_role_id = null where org_id = old.id and sub_role_id is not null;
  update companion.invites  set sub_role_id = null where org_id = old.id and sub_role_id is not null;
  return old;
end $$;
drop trigger if exists org_detach_sub_roles on companion.organisations;
create trigger org_detach_sub_roles before delete on companion.organisations
  for each row execute function companion.tg_org_detach_sub_roles();

-- ═══ 9 · RESOLUTION ════════════════════════════════════════════════

-- 9a · The effective sub-role. Branch (a) matches on id AND org AND
--      base_role: the composite FK is MATCH SIMPLE and is not enforced
--      while profiles.org_id is NULL, so a pointer into a FOREIGN org's
--      row is otherwise reachable. Archived rows still resolve in (a):
--      archiving hides a sub-role from pickers, it does not silently
--      change an assignee's permissions.
create or replace function companion.effective_sub_role(p_user_id uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  with me as (
    select p.role, p.org_id, p.sub_role_id
    from   companion.profiles p where p.id = p_user_id
  )
  select coalesce(
    (select s.id from companion.sub_roles s, me
      where s.id = me.sub_role_id
        and s.org_id is not distinct from me.org_id
        and s.base_role = me.role),
    (select s.id from companion.sub_roles s, me
      where s.org_id = me.org_id and s.base_role = me.role
        and s.is_default and s.archived_at is null
      limit 1)
  )
$$;

-- 9b · The whole algorithm, one statement.
--   1. No profile, no role, or NO ORG -> DENY ALL (fail closed).
--   2. coordinator WITH an org -> every catalogue key = true.
--   3. effective sub-role, else the org default, else none.
--   4. stored (if any) else base-role default, THEN clamped by ceiling.
--   5. Iterating role_permission_defaults (not the stored rows) makes an
--      unknown stored key inert, and makes role_permission_defaults the
--      true fail-closed floor.
--   SECURITY DEFINER is mandatory: companion.profiles' SELECT policy is
--   `org_id = public.my_org_id()`, so a SECURITY INVOKER version would
--   recurse.
create or replace function companion.permissions_for(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (
    select p.role, p.org_id from companion.profiles p where p.id = p_user_id
  )
  select case
    when (select role from me) is null or (select org_id from me) is null
      then '{}'::jsonb
    when (select role from me) = 'coordinator'
      then coalesce((select jsonb_object_agg(k.key, true)
                     from companion.permission_keys k), '{}'::jsonb)
    else coalesce((
      select jsonb_object_agg(
               d.permission_key,
               coalesce(srp.allowed, d.default_allowed) and d.max_allowed)
      from companion.role_permission_defaults d
      left join companion.sub_role_permissions srp
             on srp.sub_role_id    = companion.effective_sub_role(p_user_id)
            and srp.permission_key = d.permission_key
      where d.base_role = (select role from me)
    ), '{}'::jsonb)
  end
$$;

-- 9c · The RLS-facing wrapper. In `companion`, not `public`.
create or replace function companion.has_perm(p_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((companion.permissions_for(auth.uid()) ->> p_key)::boolean, false)
$$;

-- 9d · App-facing. MUST be in `companion`: the client is schema-pinned
--      and PostgREST resolves rpc/ inside the pinned schema.
create or replace function companion.my_permissions()
returns jsonb language sql stable security definer set search_path = '' as $$
  select companion.permissions_for(auth.uid())
$$;

-- 9e · Invite BREADTH. Resolved from the SUB-ROLE, not profiles.role —
--      after the flip every ex-trusted holder IS a support_worker, so a
--      base-role-keyed matrix cannot express parity without either
--      losing the capability or granting it org-wide.
create or replace function companion.invitable_roles_for(p_user_id uuid)
returns setof text
language sql stable security definer set search_path = '' as $$
  select ic.invitable_role
  from   companion.profiles p
  join   companion.invite_ceiling ic on ic.caller_base_role = p.role
  where  p.id = p_user_id
    and  p.org_id is not null
    and  coalesce((companion.permissions_for(p_user_id) ->> 'invite_members')::boolean, false)
    and  (
      p.role = 'coordinator'
      or exists (
        select 1 from companion.sub_role_invitable_roles sri
        where sri.sub_role_id    = companion.effective_sub_role(p_user_id)
          and sri.invitable_role = ic.invitable_role)
    )
$$;

create or replace function companion.my_invitable_roles()
returns setof text language sql stable security definer set search_path = '' as $$
  select companion.invitable_roles_for(auth.uid())
$$;

-- 9f · Seed a new org's default sub-roles. Called by create_organisation
--      / setup_family_org (069) and by the 070 backfill.
create or replace function companion.ensure_default_sub_roles(p_org_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select b.role, b.label from companion.base_roles b
           where b.sub_roles_allowed and not b.is_transitional loop
    insert into companion.sub_roles (org_id, base_role, name, is_default)
    select p_org_id, r.role, r.label, true
    where not exists (
      select 1 from companion.sub_roles s
      where s.org_id = p_org_id and s.base_role = r.role and s.is_default);
  end loop;
end $$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default.
revoke execute on function
  companion.permissions_for(uuid),
  companion.effective_sub_role(uuid),
  companion.invitable_roles_for(uuid),
  companion.ensure_default_sub_roles(uuid)
  from public, anon, authenticated;
revoke execute on function
  companion.has_perm(text), companion.my_permissions(), companion.my_invitable_roles()
  from public, anon;

grant execute on function
  companion.permissions_for(uuid),
  companion.effective_sub_role(uuid),
  companion.invitable_roles_for(uuid),
  companion.ensure_default_sub_roles(uuid)
  to service_role;
grant execute on function
  companion.has_perm(text), companion.my_permissions(), companion.my_invitable_roles()
  to authenticated, service_role;

-- ═══ 10 · MANAGEMENT RPCs · every one authorized, both ways ════════
-- The composite FK closes cross-tenant and cross-base-role assignment.
-- It says NOTHING about WHICH of your own org's same-base-role sub-roles
-- you may point at — so intra-org, intra-base-role escalation is closed
-- HERE, and only here.
--
-- Two checks in every function:
--   (i)  my_role() = 'coordinator'
--   (ii) org_id = my_org_id() on EVERY id argument

create or replace function companion.create_sub_role(
  p_base_role       text,
  p_name            text,
  p_permissions     jsonb   default '{}'::jsonb,
  p_invitable_roles text[]  default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_key text; v_val jsonb; r text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  if v_org is null then raise exception 'forbidden'; end if;

  insert into companion.sub_roles (org_id, base_role, name, created_by)
  values (v_org, p_base_role, btrim(p_name), auth.uid())
  returning id into v_id;

  for v_key, v_val in select * from pg_catalog.jsonb_each(coalesce(p_permissions,'{}'::jsonb)) loop
    if pg_catalog.jsonb_typeof(v_val) = 'boolean' then
      insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
      values (v_id, v_key, (v_val #>> '{}')::boolean);
    end if;
  end loop;

  foreach r in array coalesce(p_invitable_roles, '{}') loop
    insert into companion.sub_role_invitable_roles (sub_role_id, invitable_role) values (v_id, r);
  end loop;

  return v_id;
end $$;

create or replace function companion.update_sub_role(
  p_id              uuid,
  p_name            text,
  p_permissions     jsonb,
  p_invitable_roles text[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_key text; v_val jsonb; r text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  if not exists (select 1 from companion.sub_roles
                 where id = p_id and org_id = public.my_org_id()) then
    raise exception 'not_in_your_org';
  end if;

  update companion.sub_roles set name = btrim(p_name) where id = p_id;

  delete from companion.sub_role_permissions where sub_role_id = p_id;
  for v_key, v_val in select * from pg_catalog.jsonb_each(coalesce(p_permissions,'{}'::jsonb)) loop
    if pg_catalog.jsonb_typeof(v_val) = 'boolean' then
      insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
      values (p_id, v_key, (v_val #>> '{}')::boolean);
    end if;
  end loop;

  delete from companion.sub_role_invitable_roles where sub_role_id = p_id;
  foreach r in array coalesce(p_invitable_roles, '{}') loop
    insert into companion.sub_role_invitable_roles (sub_role_id, invitable_role) values (p_id, r);
  end loop;
end $$;

create or replace function companion.archive_sub_role(p_id uuid, p_archived boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  if not exists (select 1 from companion.sub_roles
                 where id = p_id and org_id = public.my_org_id()) then
    raise exception 'not_in_your_org';
  end if;
  if p_archived and exists (select 1 from companion.sub_roles where id = p_id and is_default) then
    raise exception 'cannot_archive_default';
  end if;
  update companion.sub_roles
    set archived_at = case when p_archived then now() else null end
    where id = p_id;
end $$;

-- Hard delete is only ever reachable through an explicit reassignment.
-- The alternative (ON DELETE SET NULL) is a SILENT privilege change to
-- real people; refuse it at the storage layer and make it explicit here.
create or replace function companion.delete_sub_role(p_id uuid, p_reassign_to uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_base text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  select base_role into v_base from companion.sub_roles where id = p_id and org_id = v_org;
  if v_base is null then raise exception 'not_in_your_org'; end if;
  if exists (select 1 from companion.sub_roles where id = p_id and is_default) then
    raise exception 'cannot_delete_default';
  end if;
  if p_reassign_to is null then raise exception 'reassign_target_required'; end if;
  if not exists (select 1 from companion.sub_roles
                 where id = p_reassign_to and org_id = v_org
                   and base_role = v_base and archived_at is null) then
    raise exception 'invalid_reassign_target';
  end if;

  update companion.profiles set sub_role_id = p_reassign_to where sub_role_id = p_id;
  update companion.invites  set sub_role_id = p_reassign_to where sub_role_id = p_id;
  delete from companion.sub_roles where id = p_id;
end $$;

-- THE self-escalation gate. Without check (ii) a plain worker could call
-- assign_sub_role(own uid, <'Trusted worker' id>) and the composite FK
-- would be perfectly satisfied: same org, same base role.
create or replace function companion.assign_sub_role(p_user_id uuid, p_sub_role_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_target_role text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  select role into v_target_role
    from companion.profiles where id = p_user_id and org_id = v_org;
  if v_target_role is null then raise exception 'not_in_your_org'; end if;

  if p_sub_role_id is not null and not exists (
       select 1 from companion.sub_roles
       where id = p_sub_role_id and org_id = v_org
         and base_role = v_target_role and archived_at is null) then
    raise exception 'invalid_sub_role';
  end if;

  update companion.profiles set sub_role_id = p_sub_role_id where id = p_user_id;
end $$;

create or replace function companion.assign_invite_sub_role(p_invite_id uuid, p_sub_role_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_role text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  select role into v_role from companion.invites where id = p_invite_id and org_id = v_org;
  if v_role is null then raise exception 'not_in_your_org'; end if;
  if p_sub_role_id is not null and not exists (
       select 1 from companion.sub_roles
       where id = p_sub_role_id and org_id = v_org
         and base_role = v_role and archived_at is null) then
    raise exception 'invalid_sub_role';
  end if;
  update companion.invites set sub_role_id = p_sub_role_id where id = p_invite_id;
end $$;

revoke execute on function
  companion.create_sub_role(text,text,jsonb,text[]),
  companion.update_sub_role(uuid,text,jsonb,text[]),
  companion.archive_sub_role(uuid,boolean),
  companion.delete_sub_role(uuid,uuid),
  companion.assign_sub_role(uuid,uuid),
  companion.assign_invite_sub_role(uuid,uuid)
  from public, anon;
grant execute on function
  companion.create_sub_role(text,text,jsonb,text[]),
  companion.update_sub_role(uuid,text,jsonb,text[]),
  companion.archive_sub_role(uuid,boolean),
  companion.delete_sub_role(uuid,uuid),
  companion.assign_sub_role(uuid,uuid),
  companion.assign_invite_sub_role(uuid,uuid)
  to authenticated;

commit;

-- ═══ POST-068 ASSERTIONS · all three must return ZERO rows ═════════
-- A. Any new table without RLS.
select relname from pg_class
where  relnamespace = 'companion'::regnamespace
  and  relname in ('base_roles','permission_keys','role_permission_defaults',
                   'invite_ceiling','sub_roles','sub_role_permissions',
                   'sub_role_invitable_roles')
  and  not relrowsecurity;

-- B. Any write privilege for anon/authenticated on the new tables.
select table_name, grantee, privilege_type
from   information_schema.role_table_grants
where  table_schema = 'companion'
  and  table_name in ('base_roles','permission_keys','role_permission_defaults',
                      'invite_ceiling','sub_roles','sub_role_permissions',
                      'sub_role_invitable_roles')
  and  grantee in ('anon','authenticated')
  and  privilege_type <> 'SELECT';

-- C. Any new function that is not SECURITY DEFINER with search_path=''.
select proname, prosecdef, proconfig from pg_proc
where  pronamespace = 'companion'::regnamespace
  and  proname in ('permissions_for','has_perm','my_permissions',
                   'effective_sub_role','invitable_roles_for','my_invitable_roles',
                   'ensure_default_sub_roles')
  and  (not prosecdef or proconfig is distinct from array['search_path=']);
