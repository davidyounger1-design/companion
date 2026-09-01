-- ═══════════════════════════════════════════════════════════════════
-- 099 · Unified invite & email auto-link, step 2 — the RPCs
--       (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-30-unified-invite-
-- email-autolink-design.md §5 and §6.5. 081's discipline exactly:
-- public schema, SECURITY DEFINER, search_path 'companion','public',
-- revoked from public+anon, granted to authenticated. Read 081's
-- header before touching either function — a wrong link is
-- cross-household, not cross-organisation.
--
-- MERGE DIRECTION (locked): the card only ever sits on a drawer the
-- signed-in account holder controls, so that drawer is always the
-- TARGET and it is absorbed INTO the pre-existing SOURCE person. In
-- the acceptance flow that means new drawer → pre-existing person; via
-- the coordinator path it means the coordinator's new drawer → the
-- account holder's pre-existing person. Same direction either way.
--
-- WHY THE SOURCE LOOKUP EXCLUDES THE TARGET'S OWN PERSON: 098's
-- trigger stamps the accepting user's email onto the just-accepted
-- drawer's own person. Without `p.id <> <target's person>` that row
-- matches alongside the genuine pre-existing one, the count is 2, and
-- the acceptance flow raises ambiguous_email_match 100% of the time.
-- The exclusion is load-bearing, not defensive.
--
-- WHY THE ABSORBED PERSON'S EMAIL IS NULLED ON COMMIT: after the
-- repoint, the orphaned person row still carries the same email. Leave
-- it and the NEXT merge for that account holder sees two matching
-- persons and raises ambiguous_email_match forever. 081 deliberately
-- does not delete orphaned solo persons rows (they may hold `about`
-- content with no recovery path), so the email is cleared instead of
-- the row — the minimum needed to keep the match key unique.
--
-- THE EXTRA GUARD vs THE CODE FLOW (spec §5.3): confirm_person_link
-- relies on possession of a 30-minute code as proof the other
-- household consented. Email has no possession analogue, so
-- foreign_recipient_login stands in for it: if the target's person
-- already has a recipient login belonging to somebody else, refuse.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · 098 must be applied first — all three columns must be present.
select table_name, column_name from information_schema.columns
where  table_schema = 'companion'
  and  (table_name, column_name) in
       (('persons','email'), ('clients','email'), ('person_links','link_method'));
-- ^ must return exactly 3 rows.

-- I2 · The shared authorisation helper this file depends on (081).
select pg_get_functiondef(oid) from pg_proc
where  proname = 'is_participant_or_decision_maker'
  and  pronamespace = 'companion'::regnamespace;

-- I3 · Neither new function may already exist under a different
--      signature (a stale overload would keep being callable).
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  p.proname in ('email_link_candidate_for','confirm_email_link');

-- I4 · How many persons rows share an email today — every group of
--      size > 1 is a household that will get the ambiguous fallback
--      rather than the one-tap card. Expect this to be near-empty
--      immediately after 098 (nothing has written emails yet).
select email, count(*) from companion.persons
where  email is not null group by email having count(*) > 1;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

-- ── 1 · The card's data source — read-only, minimum disclosure ──────
-- Server-enforced on both sides: the caller must be participant or
-- decision-maker of p_client_id AND that enrolment must already carry
-- the caller's own email. No parameter a caller can vary lets them
-- probe for an email they do not already own, so no enumeration is
-- possible (rule 1: no cross-tenant search, ever).
create or replace function public.email_link_candidate_for(p_client_id uuid)
returns jsonb
language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_caller_email text := lower(auth.email());
  v_row_email    text;
  v_own_person   uuid;
  v_match_count  int;
  v_person       companion.persons;
  v_org_name     text;
begin
  if not companion.is_participant_or_decision_maker(p_client_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select c.email, c.person_id into v_row_email, v_own_person
  from   companion.clients c where c.id = p_client_id;

  -- No email on the enrolment, or it belongs to somebody else: there is
  -- nothing this caller is entitled to be told about.
  if v_row_email is null or v_caller_email is null or v_row_email <> v_caller_email then
    return null;
  end if;

  select count(*) into v_match_count
  from   companion.persons p
  where  p.email = v_caller_email and p.id <> v_own_person;

  if v_match_count = 0 then
    return null;
  end if;

  if v_match_count > 1 then
    -- Shared household email. The card shows a notice and points at the
    -- manual code flow instead of guessing which record is meant.
    return jsonb_build_object('ambiguous', true);
  end if;

  select p.* into v_person
  from   companion.persons p
  where  p.email = v_caller_email and p.id <> v_own_person;

  -- The source person may hold several drawers; name one deterministically.
  select o.name into v_org_name
  from   companion.clients c
  join   companion.organisations o on o.id = c.org_id
  where  c.person_id = v_person.id
  order  by o.name
  limit  1;

  -- Rule 4 disclosure ceiling: first name, last initial, dob, org name
  -- and nothing else. The person's UUID is deliberately NOT returned —
  -- confirm_email_link re-resolves the source itself from the caller's
  -- own email, so the card never needs an identifier it would only be
  -- disclosing past the ceiling.
  return jsonb_build_object(
    'first_name',   split_part(v_person.full_name, ' ', 1),
    'last_initial', left(reverse(split_part(reverse(v_person.full_name), ' ', 1)), 1),
    'dob',          v_person.dob,
    'org_name',     coalesce(v_org_name, 'another plan')
  );
end;
$$;

-- ── 2 · The commit ─────────────────────────────────────────────────
create or replace function public.confirm_email_link(p_target_client_id uuid)
returns void
language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_caller_email  text := lower(auth.email());
  v_target        companion.clients;
  v_target_person uuid;
  v_source_person uuid;
  v_match_count   int;
  v_group_size    int;
  v_target_recip  uuid;
  v_caller_holds  boolean;
begin
  if not companion.is_participant_or_decision_maker(p_target_client_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  -- Lock the target enrolment before any check, so two confirms racing
  -- on the same drawer cannot both pass the chaining guard.
  perform 1 from companion.clients where id = p_target_client_id for update;

  select * into v_target from companion.clients where id = p_target_client_id;
  v_target_person := v_target.person_id;

  -- Step 1 — resolve the SOURCE person by the caller's own email,
  -- excluding the target's own person (see the file header).
  select count(*) into v_match_count
  from   companion.persons p
  where  p.email = v_caller_email and p.id <> v_target_person;

  if v_match_count = 0 then
    raise exception 'no_matching_email';
  end if;
  if v_match_count > 1 then
    raise exception 'ambiguous_email_match';
  end if;

  select p.id into v_source_person
  from   companion.persons p
  where  p.email = v_caller_email and p.id <> v_target_person;

  -- The caller must actually hold authority over the source side too —
  -- matching an email is not the same as being that person.
  select exists (
    select 1 from companion.clients c
    where  c.person_id = v_source_person
      and  companion.is_participant_or_decision_maker(c.id)
  ) into v_caller_holds;
  if not v_caller_holds then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  -- Step 2 — the target enrolment must carry the caller's email.
  if v_target.email is null or v_caller_email is null or v_target.email <> v_caller_email then
    raise exception 'target_email_mismatch';
  end if;

  -- Step 3 — no foreign recipient login on the target's person.
  select recipient_profile_id into v_target_recip
  from   companion.persons where id = v_target_person;
  if v_target_recip is not null and v_target_recip <> auth.uid() then
    raise exception 'foreign_recipient_login';
  end if;

  -- Step 4 — not self, and no chaining (rule 7, same guard as 081).
  if v_source_person = v_target_person then
    raise exception 'cannot_link_to_self';
  end if;

  select count(*) into v_group_size
  from   companion.clients where person_id = v_target_person;
  if v_group_size > 1 then
    raise exception 'target_already_linked';
  end if;

  -- Step 5 — commit. Same shape as confirm_person_link, with
  -- link_method='email' and link_code_id left null.
  insert into companion.person_links (person_id, client_id, linked_by, link_code_id, link_method)
  values (v_source_person, p_target_client_id, auth.uid(), null, 'email');

  update companion.clients set person_id = v_source_person where id = p_target_client_id;

  -- Clear the absorbed person's email — without this every FUTURE merge
  -- for this account holder raises ambiguous_email_match. The row itself
  -- is deliberately kept (081: it may hold `about` content).
  update companion.persons set email = null where id = v_target_person;
end;
$$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default.
revoke execute on function
  public.email_link_candidate_for(uuid), public.confirm_email_link(uuid)
  from public, anon;
grant execute on function
  public.email_link_candidate_for(uuid), public.confirm_email_link(uuid)
  to authenticated;

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · Structural — both SECURITY DEFINER with the right search_path.
select proname, prosecdef, proconfig from pg_proc
where  pronamespace = 'public'::regnamespace
  and  proname in ('email_link_candidate_for','confirm_email_link');

-- V2 · EXECUTE grants land exactly where intended (081's V2 shape):
--      authenticated yes, anon no.
select p.proname, r.rolname, has_function_privilege(r.oid, p.oid, 'EXECUTE') as can_execute
from   pg_proc p
join   pg_namespace n on n.oid = p.pronamespace
cross  join (select oid, rolname from pg_roles where rolname in ('anon','authenticated')) r
where  n.nspname = 'public'
  and  p.proname in ('email_link_candidate_for','confirm_email_link')
order  by p.proname, r.rolname;

-- V3 · Behavioural, SQL-editor runnable — the source-exclusion clause
--      is real. Build two persons sharing an email in two orgs, then
--      confirm the candidate query counts ONE match (the other person),
--      not two. Without `p.id <> v_own_person` this returns 2.
do $$
declare
  v_org_a uuid; v_org_b uuid;
  v_client_a uuid; v_client_b uuid;
  v_person_a uuid; v_person_b uuid;
  v_count int;
begin
  select id into v_org_a from companion.organisations order by created_at limit 1;
  select id into v_org_b from companion.organisations order by created_at desc limit 1;

  insert into companion.clients (org_id, full_name, email, active)
  values (v_org_a, '__099_source_test__', 'probe@example.com', true)
  returning id, person_id into v_client_a, v_person_a;

  insert into companion.clients (org_id, full_name, email, active)
  values (v_org_b, '__099_target_test__', 'probe@example.com', true)
  returning id, person_id into v_client_b, v_person_b;

  select count(*) into v_count
  from companion.persons p
  where p.email = 'probe@example.com' and p.id <> v_person_b;

  if v_count <> 1 then
    raise exception 'V3 FAILED: excluded-source count = %, expected 1', v_count;
  end if;

  select count(*) into v_count
  from companion.persons p where p.email = 'probe@example.com';
  if v_count <> 2 then
    raise exception 'V3 FAILED: unexcluded count = %, expected 2 (the exclusion is what makes the flow work)', v_count;
  end if;

  delete from companion.clients where id in (v_client_a, v_client_b);
  delete from companion.persons where id in (v_person_a, v_person_b);

  raise notice 'V3 PASSED: source lookup excludes the target''s own person (1 of 2); test rows cleaned up';
end $$;

-- ── Behavioural — needs two real client rows and a real participant/
--    decision-maker session; cannot be run from the SQL editor.
-- V4 · A coordinator or worker calling either RPC on ANY client →
--      refused (42501), every time. Rule 3, both directions.
-- V5 · Happy path: a two-plan recipient accepts the second invite,
--      email_link_candidate_for returns first name / last initial /
--      dob / other plan's name and nothing else; confirm_email_link
--      succeeds; clients.person_id now equals the source person; the
--      person_links row has link_method='email' and link_code_id null;
--      client_ids_for_recipient() returns BOTH enrolments.
-- V6 · PROVIDER ISOLATION (the hard rule): after V5's link, sign in as
--      each plan's coordinator and as a worker in each plan. Each must
--      still see ONLY their own org's clients row and journal entries.
--      A link merges identity, never organisation scope. If this probe
--      ever fails, stop and revert — nothing else in this design matters.
-- V7 · The absorbed person's email is null afterwards (select email
--      from companion.persons where id = <the target's OLD person_id>),
--      and a second, unrelated merge for the same account holder
--      therefore still resolves a single source rather than raising
--      ambiguous_email_match.
-- V8 · Chaining refused: email-link onto a target already merged via a
--      code link → target_already_linked.
-- V9 · Foreign recipient login on the target's person → refused
--      (foreign_recipient_login), not silently absorbed.
-- V10 · Shared household email (two persons carrying it) →
--      email_link_candidate_for returns {"ambiguous": true} and
--      confirm_email_link raises ambiguous_email_match.
-- V11 · Unlink after an email link: unlink_person works unchanged, the
--      person_links row shows unlinked_at set, the fresh snapshot row
--      carries email (098's change), and both plans' journals
--      re-isolate.
