-- ─────────────────────────────────────────────────────────────
-- 091 · Auto-link a new participant by email + link their family
--
-- David 2026-08-26: "I do not want to have to run a migration each
-- time a participant is created — the system should somehow be able
-- to detect that the email address already exists and just link them
-- along with the participants family members."
--
-- Ruled: FULLY AUTOMATIC — a unique exact-email match links instantly
-- at creation (no confirm step). Safety nets per the identity-model
-- spec (2026-08-24-identity-access-model-design.md):
--   · rule 6 audit — every auto-link writes a person_links row
--   · notice posted to the matched side's family (one per other org
--     where the matched person has a drawer)
--   · reversible — unlink_person (081) still works on any linked drawer
--   · rule 1 privacy — the RPC discloses nothing about candidates:
--     reasons are only 'matched' / 'none' / 'ambiguous', and an email
--     already present in the creating org is refused with a generic
--     message. No cross-tenant search surface is exposed (the caller
--     must already know the exact email).
--   · chaining guard — a family-pass target is only repointed when its
--     current person has no other drawer (mirrors 081's guard).
--
-- Scope decisions (ruled):
--   · Family pass links family members' drawers that already exist in
--     the creating org (family onboarded before/after the participant,
--     either order works). Family links are audited but do NOT post
--     notices — one notice about the participant is enough signal.
--   · An ambiguous match (2+ identities outside the org share the
--     email, e.g. an existing unlinked duplicate) creates the drawer
--     unlinked and returns reason 'ambiguous' — fixable later with the
--     081 manual link flow.
--   · The 055 seat-limit trigger and the 082 person-creation trigger
--     both still fire (this inserts through clients, not around it).
--
-- persons.email is the identity email. For account-linked persons it
-- mirrors auth.users.email via recipient_profile_id (kept in sync by
-- the update-member-email flow); the backfill below populates it
-- once for existing data.
-- ─────────────────────────────────────────────────────────────

begin;

-- 1 · Identity email column ───────────────────────────────────
alter table companion.persons add column if not exists email text;

-- 2 · One-time backfill for account-linked persons ─────────────
update companion.persons p
set email = lower(u.email)
from companion.profiles pr
join auth.users u on u.id = pr.id
where p.recipient_profile_id = pr.id
  and p.email is null;

-- 3 · The RPC ──────────────────────────────────────────────────
create or replace function public.create_participant(
  p_org_id    uuid,
  p_full_name text,
  p_dob       date   default null,
  p_email     text   default null,
  p_active    boolean default true
)
returns json
language plpgsql security definer
set search_path = 'companion', 'public'
as $function$
declare
  v_uid      uuid  := auth.uid();
  v_email    text  := nullif(lower(btrim(p_email)), '');
  v_new_client uuid;
  v_new_person uuid;
  v_matched  uuid;
  v_match_count int;
  v_linked   int   := 0;
  v_fam      record;
  v_fm_email text;
  v_fm_person uuid;
  v_target   record;
  v_notice   record;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_full_name is null or btrim(p_full_name) = '' then
    raise exception 'participant name is required' using errcode = 'P0001';
  end if;

  -- Caller must be a coordinator or family member of the org — mirrors
  -- the two clients insert policies ("coordinators can manage clients",
  -- "family can manage clients in org"), read via profile_orgs (079).
  perform 1 from companion.profile_orgs po
   where po.profile_id = v_uid and po.org_id = p_org_id
     and po.left_at is null and po.role in ('coordinator', 'family');
  if not found then
    raise exception 'not authorised to add participants to this organisation'
      using errcode = '42501';
  end if;

  -- Refuse before inserting anything if this email already has a drawer
  -- in the creating org (would duplicate the person inside one plan).
  if v_email is not null and exists (
    select 1
    from companion.clients c
    join companion.persons p on p.id = c.person_id
    left join companion.profiles pr on pr.id = p.recipient_profile_id
    left join auth.users u on u.id = pr.id
    where c.org_id = p_org_id
      and (p.email = v_email or lower(u.email) = v_email)
  ) then
    return json_build_object('ok', false, 'error',
      'A participant with this email is already in this plan');
  end if;

  -- Insert the participant. The 082 BEFORE INSERT trigger creates the
  -- person row; the 055 seat-limit trigger still enforces plan seats.
  insert into companion.clients (org_id, full_name, dob, active)
  values (p_org_id, p_full_name, p_dob, p_active)
  returning id, person_id into v_new_client, v_new_person;

  -- Record the email on the identity row (identity model §2.1.1: email
  -- belongs to the person; account-linked persons mirror auth email).
  if v_email is not null then
    update companion.persons set email = v_email where id = v_new_person;
  end if;

  -- ── Auto-link: unique exact-email match outside this org ──
  if v_email is not null then
    select p.id, count(*) over ()
      into v_matched, v_match_count
    from companion.persons p
    where p.id <> v_new_person
      and (
        p.email = v_email
        or exists (
          select 1
          from companion.profiles pr
          join auth.users u on u.id = pr.id
          where pr.id = p.recipient_profile_id and lower(u.email) = v_email
        )
      )
      and exists (
        select 1 from companion.clients c
        where c.person_id = p.id and c.org_id <> p_org_id
      )
    limit 1;

    if v_match_count = 1 then
      -- Repoint the new drawer at the existing identity + audit (rule 6).
      update companion.clients set person_id = v_matched where id = v_new_client;
      insert into companion.person_links (person_id, client_id, linked_by, linked_at)
      values (v_matched, v_new_client, v_uid, now());

      -- The trigger-born person holds only defaults — remove it so the
      -- identity model doesn't accumulate one dead person per creation.
      delete from companion.persons where id = v_new_person;
      v_linked := 1;

      -- Safety net: tell the matched side's family. One notice per other
      -- org where the matched person has a drawer (author = the caller,
      -- so the household can see who caused the link).
      for v_notice in
        select c.id as client_id, c.org_id
        from companion.clients c
        where c.person_id = v_matched and c.org_id <> p_org_id
      loop
        insert into companion.notices (org_id, client_id, author_id, body)
        values (v_notice.org_id, v_notice.client_id, v_uid,
          'A participant record in another plan matched this participant''s '
          || 'email address and was linked automatically. If this is '
          || 'unexpected, the link can be undone from the family view.');
      end loop;

      -- ── Family pass ──
      -- For each active family member of the matched person's drawers,
      -- link any of their drawers already created in the creating org
      -- (family onboards each member separately, in any order).
      for v_fam in
        select distinct cf.family_id
        from companion.clients c
        join companion.client_family cf on cf.client_id = c.id and cf.status = 'active'
        where c.person_id = v_matched
      loop
        -- The family member's email from their auth account (skip
        -- members without an account — nothing to match on).
        select lower(u.email) into v_fm_email
        from companion.profiles pr
        join auth.users u on u.id = pr.id
        where pr.id = v_fam.family_id;

        -- The family member's own identity row: prefer their
        -- account-linked person, else any person carrying their email.
        select p.id into v_fm_person
        from companion.persons p
        where p.recipient_profile_id = v_fam.family_id
           or (v_fm_email is not null and p.email = v_fm_email)
        order by (p.recipient_profile_id = v_fam.family_id) desc nulls last
        limit 1;

        if v_fm_person is not null then
          for v_target in
            select c.id as client_id, p.id as person_id
            from companion.clients c
            join companion.persons p on p.id = c.person_id
            left join companion.profiles pr on pr.id = p.recipient_profile_id
            left join auth.users u on u.id = pr.id
            where c.org_id = p_org_id
              and c.person_id <> v_matched
              and (p.email = v_fm_email or lower(u.email) = v_fm_email)
              and not exists (
                -- chaining guard: never repoint a drawer whose person is
                -- shared by another drawer
                select 1 from companion.clients c2
                where c2.person_id = p.id and c2.id <> c.id
              )
          loop
            update companion.clients set person_id = v_fm_person where id = v_target.client_id;
            insert into companion.person_links (person_id, client_id, linked_by, linked_at)
            values (v_fm_person, v_target.client_id, v_uid, now());
            delete from companion.persons where id = v_target.person_id;
            v_linked := v_linked + 1;
          end loop;
        end if;
      end loop;

      return json_build_object(
        'ok', true,
        'client_id', v_new_client::text,
        'person_id', v_matched::text,
        'linked', true,
        'reason', 'matched',
        'linked_count', v_linked
      );
    elsif v_match_count > 1 then
      -- Safety stop: 2+ identities outside this org share the email
      -- (e.g. an existing unlinked duplicate). Create unlinked, disclose
      -- nothing. The duplicate can be resolved with 081's manual flow.
      return json_build_object(
        'ok', true,
        'client_id', v_new_client::text,
        'person_id', v_new_person::text,
        'linked', false,
        'reason', 'ambiguous'
      );
    end if;
  end if;

  return json_build_object(
    'ok', true,
    'client_id', v_new_client::text,
    'person_id', v_new_person::text,
    'linked', false,
    'reason', 'none'
  );
end $function$;

-- 4 · Grants — authenticated app users only (081 pattern) ─────
revoke all on function public.create_participant(uuid, text, date, text, boolean)
  from public, anon;
grant execute on function public.create_participant(uuid, text, date, text, boolean)
  to authenticated;

commit;

-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION — run after the commit above.
-- ═══════════════════════════════════════════════════════════════

-- V1 · Structural — both should return rows.
select column_name from information_schema.columns
where table_schema = 'companion' and table_name = 'persons'
  and column_name = 'email';

select proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname = 'create_participant';

-- V2 · Backfill check — every account-linked person should now have an
--      email. Expect 0 rows.
select count(*)
from companion.persons p
join companion.profiles pr on pr.id = p.recipient_profile_id
join auth.users u on u.id = pr.id
where p.email is null;

-- V3 · Behavioural — cannot be run from the SQL editor (needs two
--      authenticated sessions in different orgs). Covered by the
--      frontend flow: create a participant with an email that already
--      exists as a participant in another org → expect linked:true,
--      a person_links row, a notice in the other org, and the family
--      pass linking matching family drawers.
