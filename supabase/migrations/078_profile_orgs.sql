-- ═══════════════════════════════════════════════════════════════════
-- 078 · Identity & access model, Step 2 — profile_orgs, additive only
--       (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-24-identity-access-
-- model-design.md §2.2, §5 step 2.
--
-- WHAT THIS DOES: creates companion.profile_orgs (multi-plan membership
-- — a profile can belong to more than one org, with its own role and
-- sub_role_id per membership) and backfills one row per profile that
-- currently has a non-null org_id.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: profiles.org_id/role/sub_role_id
-- are UNTOUCHED — kept as "primary plan" for the duration of this
-- migration path (§5: "retained and kept in sync ... so nothing breaks
-- mid-flight; they are dropped only after every reader is moved").
-- Nothing reads profile_orgs yet. Zero behaviour change.
--
-- Live profiles today (checked 2026-08-24): 13 rows, all with a non-
-- null org_id (no detached family profile exists right now) — 3
-- coordinator, 2 family, 1 recipient, 7 support_worker (all 7 already
-- carry a sub_role_id, consistent with the sub-role rollout being
-- complete). Backfill produces exactly 13 profile_orgs rows.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · Every profile's current org_id/role/sub_role_id.
select id, org_id, role, sub_role_id, created_at from companion.profiles order by org_id, role;

-- I2 · sub_roles' unique constraint the composite FK depends on —
--      confirm it's (id, org_id, base_role) before referencing it.
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'companion.sub_roles'::regclass and contype = 'u';


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

create table if not exists companion.profile_orgs (
  profile_id  uuid not null references companion.profiles(id) on delete cascade,
  org_id      uuid not null references companion.organisations(id) on delete cascade,
  role        text not null,
  sub_role_id uuid,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  primary key (profile_id, org_id)
);

-- Same composite-FK shape 068 established for profiles.sub_role_id —
-- see that migration's own header for why RESTRICT/RESTRICT, not
-- SET NULL/CASCADE (a multi-column cascade here would propagate an
-- UPDATE of sub_roles.org_id into profile_orgs.org_id, a one-statement
-- cross-tenant move).
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'profile_orgs_sub_role_fk'
                   and conrelid = 'companion.profile_orgs'::regclass) then
    alter table companion.profile_orgs
      add constraint profile_orgs_sub_role_fk
      foreign key (sub_role_id, org_id, role)
      references companion.sub_roles (id, org_id, base_role)
      on delete restrict on update restrict;
  end if;
end $$;

-- Backfill: one row per profile with a non-null org_id today. joined_at
-- approximated from profiles.created_at — there is no better historical
-- record of when this specific membership began (a profile that has
-- changed orgs before this migration has already lost that history).
insert into companion.profile_orgs (profile_id, org_id, role, sub_role_id, joined_at)
select p.id, p.org_id, p.role, p.sub_role_id, p.created_at
from   companion.profiles p
where  p.org_id is not null
on conflict (profile_id, org_id) do nothing;

-- ── RLS + grants ─────────────────────────────────────────────────────
alter table companion.profile_orgs enable row level security;
revoke all on table companion.profile_orgs from anon, authenticated;
grant select on companion.profile_orgs to authenticated;

-- Mirrors profiles' own read rule (§ I confirmed before writing this):
-- any member of the org can see who else is in it, plus you can always
-- see your own memberships regardless of org. No write grant — this is
-- backend-only until step 6 (linking) and the multi-plan frontend work
-- give it a real write path.
drop policy if exists "org members can view memberships" on companion.profile_orgs;
create policy "org members can view memberships"
  on companion.profile_orgs for select
  using (
    profile_id = auth.uid()
    or org_id = public.my_org_id()
  );

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · Row count equals the count of profiles with a non-null org_id,
--      and every role matches its source profile.
select
  (select count(*) from companion.profile_orgs) as profile_orgs_rows,
  (select count(*) from companion.profiles where org_id is not null) as profiles_with_org;

select po.profile_id, po.role as membership_role, p.role as profile_role,
       po.sub_role_id = p.sub_role_id as sub_role_matches
from   companion.profile_orgs po join companion.profiles p on p.id = po.profile_id
where  po.role is distinct from p.role or po.sub_role_id is distinct from p.sub_role_id;
-- ^ must return zero rows — any row here is a backfill mismatch.

-- V2 · RLS enabled, no non-SELECT grant to anon/authenticated.
select relrowsecurity from pg_class
where relname = 'profile_orgs' and relnamespace = 'companion'::regnamespace;
select grantee, privilege_type from information_schema.role_table_grants
where table_schema = 'companion' and table_name = 'profile_orgs' and grantee in ('anon', 'authenticated');

-- V3 · The composite FK is enforced (not NOT VALID this time — no
--      existing row needed grandfathering in, unlike 068's rollout).
select conname, convalidated from pg_constraint where conname = 'profile_orgs_sub_role_fk';
