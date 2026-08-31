# Unified Invite, Email & Auto-Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect an email on the participant record, replace every role-specific invite UI with one plain-language invite modal, and let an account holder one-tap link their own records across two Companion plans when the system recognises their email — without any cross-tenant search ever becoming possible.

**Architecture:** Two additive migrations first (columns + trigger extension + a one-line `accept_invite` change; then two new `public` SECURITY DEFINER RPCs), then one new edge function deployed but unwired, then the UI wiring on top. The merge itself reuses the existing 081 person-linking machinery: `person_links` gains a `link_method` discriminator, and the email path repoints a target drawer's `person_id` onto a pre-existing source person exactly as the code path does. Provider isolation is untouched — RLS on `companion.clients` and the journal tables stays org-scoped; a link merges identity, never organisation scope.

**Tech Stack:** React 19 + Vite 8 + TypeScript (no build-time test framework), `@tanstack/react-query` v5, `@supabase/supabase-js` v2, Supabase Postgres (schema `companion`), Deno edge functions, Resend for email.

**Spec:** `docs/superpowers/specs/2026-08-30-unified-invite-email-autolink-design.md`

---

## Global Constraints

- **Work in an isolated worktree.** Another Claude session is actively working in `E:\companion`. Do not implement in the shared checkout — create a git worktree + feature branch, PR → squash-merge to `master` → GitHub Actions deploys. Never stage or commit the other session's files (`supabase/.temp/*`, `supabase/config.toml`, `MAB-HANDOFF.md`, `SUBSCRIPTION_CARDS_SPEC.md`, `docs/superpowers/rostering-worklog.md`, `supabase/functions/admin-impersonate/`, `.claude/worktrees/`).
- **`git pull` before reasoning about anything.** The concurrent session ships migrations and version bumps continuously.
- **Every SQL identifier is schema-qualified** (`companion.persons`, not `persons`). Companion's tables live in the `companion` Postgres schema; RPCs live in `public` with `set search_path = 'companion', 'public'`.
- **Migrations are never auto-applied.** They are handed to David to paste into the Supabase SQL editor. Every migration file follows the 077–083 template: `INSPECT FIRST` (read-only) → `THE MIGRATION` (inside `begin;`/`commit;`) → `POST-MIGRATION VERIFICATION` (structural queries + `do $$` behavioural probes).
- **Edge functions are single-file** (`supabase/functions/<name>/index.ts`), no `_shared` imports, pasted into the dashboard manually. Never auto-deploy.
- **Never paste API keys, tokens, DB passwords, or config contents into chat.** The Resend key stays in Supabase secrets (`RESEND_API_KEY`).
- **Version source of truth is `package.json`.** `src/lib/version.ts` re-exports the build-injected `__APP_VERSION__` from vite's `define` — never edit it. A version bump and a `src/pages/ReleaseNotes.tsx` entry always travel together.
- **No test framework exists.** `package.json` scripts are `dev` / `build` (`tsc && vite build`) / `preview` only. DB tasks are verified by their own migration file's INSPECT-first queries and post-migration `do $$` probes (David runs them). Frontend tasks end with manual QA plus `npm run build` passing.
- **Commit style:** descriptive imperative subject line, then a short "why" paragraph in the body.
- **Never fabricate an existing function body.** Before `create or replace`, read the live definition with `select pg_get_functiondef(oid) from pg_proc where ...` — every migration below starts with exactly that INSPECT query. Read any source file fresh before quoting it.
- **Migration numbers verified 2026-08-31:** `supabase/migrations/` currently ends at `095_rostering_notify.sql` (the concurrent session added 091–095 after the spec was written, which named 091/092). This plan therefore uses **096** and **097**. Re-check `supabase/migrations/` before creating either file; if 096/097 are taken, renumber to the next free pair and update the cross-references in Tasks 2 and 11.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `supabase/migrations/096_email_link_columns.sql` | Additive schema: `persons.email`, `clients.email`, `person_links.link_method`; extends the 082 trigger to a BEFORE INSERT OR UPDATE promoter; one-line `accept_invite` change; `unlink_person` snapshot carries email. Zero behaviour change on its own. |
| `supabase/migrations/097_email_link_rpcs.sql` | `public.email_link_candidate_for(uuid)` (read-only card data source) and `public.confirm_email_link(uuid)` (the commit). 081's discipline exactly. |
| `supabase/functions/offer-email-link/index.ts` | Fire-and-forget cross-org recognition email on participant-create-with-email. Returns `{ ok: true }` in every case. |
| `src/components/InviteMemberModal.tsx` | The one unified invite modal, extracted from MembersPage's local `InviteModal` and given a plain-language role picker plus pinning props. |
| `src/components/EmailLinkCard.tsx` | The one-tap acceptance-flow link card. |

**Modified:**

| Path | Change |
|---|---|
| `src/pages/auth/AcceptInvite.tsx` | `ROLE_LABEL.recipient` wording. |
| `src/pages/members/MembersPage.tsx` | `ROLE_LABEL.recipient` wording; delete local `InviteModal`, use the new component. |
| `supabase/functions/invite-member/index.ts` | `ROLE_LABEL.recipient` wording. |
| `src/pages/setup/Step4Clients.tsx` | Email field + "send login invite" checkbox on add-participant. |
| `src/pages/setup/family/FamilyStep1Participant.tsx` | Same, on the family-plan first step. |
| `src/pages/setup/family/FamilyStep2Invite.tsx` | Replace the inline invite form with `InviteMemberModal`. |
| `src/components/ClientManagePanel.tsx` | New "Participant login" section with an "Invite to log in" action. |
| `src/pages/family/FamilyDashboard.tsx` | Mount `EmailLinkCard` beside `PersonLinkPanel`. |
| `package.json` / `src/pages/ReleaseNotes.tsx` | Version bump + release-notes entry. |

**Rollout order (spec §9, "additive first, cut over last"):** Task 1 → Task 2 → Task 3 are each shippable with zero user-visible change. Tasks 4–10 wire the UI. Task 11 ships it. At no point is the app broken mid-sequence.

---

### Task 1: Migration 096 — email columns, trigger promotion, accept_invite

**Files:**
- Create: `supabase/migrations/096_email_link_columns.sql`
- Test: none (no test framework — the migration file carries its own INSPECT + VERIFICATION probes, run by David in the Supabase SQL editor)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `companion.persons.email text` (nullable, no unique constraint, lowercased on write), `companion.clients.email text` (nullable, per-enrolment, lowercased on write), `companion.person_links.link_method text not null default 'code' check (link_method in ('code','email'))`. Task 2's RPCs read all three. Task 3's edge function reads `companion.persons.email`. Tasks 5, 6 and 8 write `companion.clients.email`.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/096_email_link_columns.sql` with exactly this content:

```sql
-- ═══════════════════════════════════════════════════════════════════
-- 096 · Unified invite & email auto-link, step 1 — additive only
--       (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-30-unified-invite-
-- email-autolink-design.md §6. This migration alone changes NO
-- behaviour: it adds three nullable/defaulted columns, extends 082's
-- BEFORE INSERT trigger to also fire on UPDATE, changes one line of
-- accept_invite, and adds one column to unlink_person's snapshot.
-- The RPCs that actually use any of it land in 097.
--
-- WHY persons.email has NO unique constraint: a shared family email
-- producing several persons rows is a DESIGNED ambiguity case (the
-- linking RPCs return `ambiguous_email_match` and fall back to the
-- manual code flow), not corruption. A unique constraint would turn
-- that ordinary situation into a hard insert failure on the
-- add-participant form.
--
-- WHY the trigger gains an UPDATE branch: accept_invite sets
-- clients.recipient_profile_id (and, from this migration, clients.email)
-- on an EXISTING row. Without an UPDATE branch none of it ever reaches
-- the person-level copy, so the acceptance card would have no match key
-- to work from. First value promoted wins — a later, differing email on
-- another enrolment stays enrolment-only and never becomes a match key.
--
-- THE recipient_profile_id PROMOTE (spec §6.7): no accept_invite
-- lineage (026, 041, 069, 083) has ever synced clients.recipient_
-- profile_id to the person-level copy, and 080's
-- client_ids_for_recipient() reads the person-level copy. So a
-- recipient who accepted an invite after 077 has the clients-side set
-- and the persons-side null, and the merged-view helper returns nothing
-- for them. That is live-broken today, independent of this design. It
-- rides the same UPDATE branch, with the same first-wins semantics.
-- I6 below counts how many rows are currently in that state.
-- ═══════════════════════════════════════════════════════════════════


-- ═══ INSPECT FIRST — read-only. ═════════════════════════════════════

-- I1 · Current columns on persons and clients — `email` must not
--      already exist on either.
select table_name, column_name, data_type, is_nullable
from   information_schema.columns
where  table_schema = 'companion' and table_name in ('persons','clients')
order  by table_name, ordinal_position;

-- I2 · Current columns on person_links — `link_method` must not
--      already exist.
select column_name, data_type, is_nullable, column_default
from   information_schema.columns
where  table_schema = 'companion' and table_name = 'person_links'
order  by ordinal_position;

-- I3 · Live body of the trigger function this migration replaces
--      (082's version). Read it before replacing it — never work from
--      a remembered body.
select pg_get_functiondef(oid) from pg_proc
where  proname = 'auto_create_person_for_client'
  and  pronamespace = 'companion'::regnamespace;

-- I4 · Live body of accept_invite (083's version) — the migration
--      below reproduces it verbatim with ONE line changed.
select pg_get_functiondef(oid) from pg_proc
where  proname = 'accept_invite' and pronamespace = 'companion'::regnamespace;

-- I5 · Live body of unlink_person (081's version) — same deal, one
--      column added to its snapshot INSERT.
select pg_get_functiondef(oid) from pg_proc
where  proname = 'unlink_person' and pronamespace = 'public'::regnamespace;

-- I6 · Spec §6.7 — how many enrolments currently have a recipient
--      login on the clients row but NOT on the person row. Every one
--      of these is a participant for whom client_ids_for_recipient()
--      returns nothing today. This migration fixes them going forward
--      (on the next update of the row); it deliberately does NOT
--      backfill — a backfill would need its own reviewed decision
--      about which enrolment's login wins per person.
select c.id as client_id, c.org_id, c.full_name,
       c.recipient_profile_id as client_side, p.recipient_profile_id as person_side
from   companion.clients c
join   companion.persons p on p.id = c.person_id
where  c.recipient_profile_id is not null and p.recipient_profile_id is null
order  by c.org_id, c.full_name;


-- ═══ THE MIGRATION ══════════════════════════════════════════════════
begin;

-- ── 1 · Columns ─────────────────────────────────────────────────────
alter table companion.persons      add column if not exists email text;
alter table companion.clients      add column if not exists email text;
alter table companion.person_links add column if not exists link_method text not null default 'code';

-- Existing person_links rows become 'code' via the default above.
-- Email-linked rows carry link_code_id null (already nullable).
alter table companion.person_links drop constraint if exists person_links_link_method_check;
alter table companion.person_links add  constraint person_links_link_method_check
  check (link_method in ('code','email'));

-- ── 2 · The trigger: INSERT carries email, UPDATE promotes ──────────
-- Normalising email on the row itself (lower + trim, '' → null) is the
-- reason every downstream comparison can be a plain `=` against
-- lower(auth.email()) instead of a function call that would defeat any
-- future index.
create or replace function companion.auto_create_person_for_client()
returns trigger language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_person_id uuid;
begin
  new.email := nullif(lower(trim(new.email)), '');

  if tg_op = 'INSERT' then
    if new.person_id is null then
      insert into companion.persons (full_name, dob, about, recipient_profile_id, email)
      values (new.full_name, new.dob, new.about, new.recipient_profile_id, new.email)
      returning id into v_person_id;
      new.person_id := v_person_id;
    end if;
    return new;
  end if;

  -- UPDATE: promote to the person-level copy, first value wins. Both
  -- updates are no-ops once the person row already carries a value —
  -- that is what makes "first wins" true without extra branching.
  if new.person_id is not null then
    if new.email is not null then
      update companion.persons
      set    email = new.email
      where  id = new.person_id and email is null;
    end if;

    if new.recipient_profile_id is not null then
      update companion.persons
      set    recipient_profile_id = new.recipient_profile_id
      where  id = new.person_id and recipient_profile_id is null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists clients_auto_create_person on companion.clients;
create trigger clients_auto_create_person
  before insert or update on companion.clients
  for each row execute function companion.auto_create_person_for_client();

-- ── 3 · accept_invite — 083's body, ONE line changed ────────────────
-- The recipient branch now sets clients.email from the invite when the
-- enrolment has none. The trigger's UPDATE branch above then promotes
-- it to persons.email. This is what makes the acceptance card possible
-- when the coordinator never typed an email on the participant form.
create or replace function companion.accept_invite(p_token text)
returns json
language plpgsql security definer
set search_path = 'companion', 'public' as $function$
declare
  v_invite   companion.invites%rowtype;
  v_uid      uuid := auth.uid();
  v_email    text := auth.email();
  v_sub      uuid;
begin
  if v_uid is null then
    return json_build_object('error', 'not_authenticated');
  end if;

  select * into v_invite
  from companion.invites
  where token = p_token and status = 'pending'
  for update;

  if not found then
    return json_build_object('error', 'invalid_or_used');
  end if;

  if v_invite.expires_at < now() then
    update companion.invites set status = 'expired' where id = v_invite.id;
    return json_build_object('error', 'expired');
  end if;

  if lower(v_invite.email) != lower(v_email) then
    return json_build_object('error', 'invite_not_for_this_account');
  end if;

  v_sub := v_invite.sub_role_id;
  if v_sub is null and v_invite.role <> 'coordinator' then
    select s.id into v_sub from companion.sub_roles s
     where s.org_id = v_invite.org_id and s.base_role = v_invite.role
       and s.is_default and s.archived_at is null limit 1;
  end if;

  update companion.profiles
  set org_id = v_invite.org_id, role = v_invite.role, sub_role_id = v_sub
  where id = v_uid;

  -- Keep profile_orgs in sync — this is what my_org_id()/my_role()
  -- actually read since 079. ON CONFLICT handles re-joining an org
  -- this profile had previously left.
  insert into companion.profile_orgs (profile_id, org_id, role, sub_role_id)
  values (v_uid, v_invite.org_id, v_invite.role, v_sub)
  on conflict (profile_id, org_id) do update
    set role = excluded.role, sub_role_id = excluded.sub_role_id, left_at = null;

  if v_invite.client_id is not null then
    if v_invite.role = 'family' then
      insert into companion.client_family (client_id, family_id, status)
      values (v_invite.client_id, v_uid, 'active')
      on conflict (client_id, family_id) do update set status = 'active';
    elsif v_invite.role in ('support_worker', 'trusted_support_worker') then
      insert into companion.client_workers (client_id, worker_id)
      values (v_invite.client_id, v_uid)
      on conflict (client_id, worker_id) do nothing;
    elsif v_invite.role = 'recipient' then
      update companion.clients
      set    recipient_profile_id = v_uid,
             email = coalesce(email, lower(v_invite.email))
      where  id = v_invite.client_id;
    elsif v_invite.role = 'therapist' then
      insert into companion.client_circle (client_id, therapist_id, status)
      values (v_invite.client_id, v_uid, 'in_circle')
      on conflict (client_id, therapist_id) do update set status = 'in_circle';
    end if;
  end if;

  update companion.invites set status = 'accepted' where id = v_invite.id;

  return json_build_object(
    'ok',     true,
    'role',   v_invite.role,
    'org_id', v_invite.org_id::text
  );
end $function$;

-- ── 4 · unlink_person — 081's body, snapshot carries email ──────────
-- The two INSERT-into-persons sites in this whole design (the trigger
-- above and this snapshot) both carry email, so an unlinked drawer
-- keeps its match key rather than silently losing it.
create or replace function public.unlink_person(p_client_id uuid)
returns void
language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_current_person companion.persons;
  v_new_person_id  uuid;
  v_group_size     int;
begin
  if not companion.is_participant_or_decision_maker(p_client_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  select p.* into v_current_person
  from   companion.clients c join companion.persons p on p.id = c.person_id
  where  c.id = p_client_id;

  select count(*) into v_group_size
  from companion.clients where person_id = v_current_person.id;
  if v_group_size <= 1 then
    raise exception 'not_linked';
  end if;

  update companion.person_links
  set unlinked_at = now(), unlinked_by = auth.uid()
  where client_id = p_client_id and unlinked_at is null;

  insert into companion.persons (full_name, dob, about, recipient_profile_id, email)
  values (v_current_person.full_name, v_current_person.dob, v_current_person.about,
          v_current_person.recipient_profile_id, v_current_person.email)
  returning id into v_new_person_id;

  update companion.clients set person_id = v_new_person_id where id = p_client_id;
end;
$$;

commit;


-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · The three columns exist, all nullable-or-defaulted, and
--      persons.email has NO unique constraint (by design).
select table_name, column_name, data_type, is_nullable, column_default
from   information_schema.columns
where  table_schema = 'companion'
  and  (table_name, column_name) in
       (('persons','email'), ('clients','email'), ('person_links','link_method'));

select conname, pg_get_constraintdef(oid) from pg_constraint
where  conrelid = 'companion.persons'::regclass and contype = 'u';
-- ^ must NOT list any constraint covering `email`.

select conname, pg_get_constraintdef(oid) from pg_constraint
where  conrelid = 'companion.person_links'::regclass
  and  conname = 'person_links_link_method_check';

-- V2 · Every pre-existing person_links row picked up 'code'.
select link_method, count(*) from companion.person_links group by link_method;

-- V3 · The trigger now fires BEFORE INSERT OR UPDATE, per row.
select tgname, pg_get_triggerdef(oid) from pg_trigger
where  tgrelid = 'companion.clients'::regclass
  and  tgname = 'clients_auto_create_person';

-- V4 · Behavioural — INSERT carries + normalises email; UPDATE
--      promotes email and recipient_profile_id first-wins; a SECOND,
--      differing email does NOT overwrite. Cleans up after itself.
do $$
declare
  v_org       uuid;
  v_profile   uuid;
  v_client    uuid;
  v_person    uuid;
  v_email     text;
  v_recip     uuid;
begin
  select id into v_org     from companion.organisations limit 1;
  select id into v_profile from companion.profiles      limit 1;

  -- INSERT path: email normalised (lower + trim) onto the new person.
  insert into companion.clients (org_id, full_name, email, active)
  values (v_org, '__096_trigger_test__', '  MiXeD@Example.COM  ', true)
  returning id, person_id into v_client, v_person;

  select email into v_email from companion.persons where id = v_person;
  if v_email is distinct from 'mixed@example.com' then
    raise exception 'V4 FAILED (insert): persons.email = %, expected mixed@example.com', v_email;
  end if;

  -- UPDATE path, email: a DIFFERENT email must NOT overwrite the first.
  update companion.clients set email = 'second@example.com' where id = v_client;
  select email into v_email from companion.persons where id = v_person;
  if v_email is distinct from 'mixed@example.com' then
    raise exception 'V4 FAILED (first-wins): persons.email = %, expected mixed@example.com', v_email;
  end if;

  -- UPDATE path, recipient_profile_id: promoted when the person has none.
  update companion.clients set recipient_profile_id = v_profile where id = v_client;
  select recipient_profile_id into v_recip from companion.persons where id = v_person;
  if v_recip is distinct from v_profile then
    raise exception 'V4 FAILED (recipient promote): persons.recipient_profile_id = %, expected %', v_recip, v_profile;
  end if;

  delete from companion.clients where id = v_client;
  delete from companion.persons where id = v_person;

  raise notice 'V4 PASSED: insert-carries, first-wins email, recipient promote all correct; test rows cleaned up';
end $$;

-- V5 · Behavioural — an INSERT with a null/blank email leaves
--      persons.email null (no empty strings sneaking in as match keys).
do $$
declare
  v_org uuid; v_client uuid; v_person uuid; v_email text;
begin
  select id into v_org from companion.organisations limit 1;

  insert into companion.clients (org_id, full_name, email, active)
  values (v_org, '__096_blank_email_test__', '   ', true)
  returning id, person_id into v_client, v_person;

  select email into v_email from companion.persons where id = v_person;
  if v_email is not null then
    raise exception 'V5 FAILED: blank email stored as %, expected null', quote_literal(v_email);
  end if;

  delete from companion.clients where id = v_client;
  delete from companion.persons where id = v_person;

  raise notice 'V5 PASSED: blank email normalised to null on both rows; test rows cleaned up';
end $$;

-- ── Behavioural, needs a real session (documented, not runnable here) ──
-- V6 · Accept a recipient invite for an enrolment whose clients.email
--      is null → afterwards clients.email equals the invite's email
--      (lowercased) AND persons.email equals it too. This is the
--      acceptance card's precondition (spec §8).
```

- [ ] **Step 2: Verify the file parses as SQL before handing it over**

There is no local Postgres. Verification is David running the file's own probes. Before that, self-check the file mechanically:

Run: `node -e "const s=require('fs').readFileSync('supabase/migrations/096_email_link_columns.sql','utf8'); const n=(s.match(/\$\$/g)||[]).length; if(n%2) throw new Error('unbalanced $$ delimiters: '+n); if(!s.includes('begin;')||!s.includes('commit;')) throw new Error('missing transaction wrapper'); console.log('ok: '+n+' $$ delimiters, transaction wrapped')"`

Expected: `ok: 8 $$ delimiters, transaction wrapped`

- [ ] **Step 3: Hand the SQL to David and record the result**

Paste the whole file into chat (per the standing "show SQL inline" rule — never just point at the path) and ask David to run it in the Supabase SQL editor, section by section: INSPECT first, then the migration, then the verification block. Record I6's row count in the handoff — it is the live size of the spec §6.7 problem.

Do not proceed to Task 2 until V1–V5 have all reported PASSED.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/096_email_link_columns.sql
git commit -m "Add email columns and person-level promotion trigger

Adds persons.email/clients.email as the auto-link match key and
person_links.link_method to tell code links from email links. Extends
082's insert trigger to also fire on update so accept_invite's client
update promotes both the email and (spec 6.7) the recipient login to
the person row, which client_ids_for_recipient has been reading as null
for every post-077 recipient. Additive only: nothing reads any of it
until 097."
```

---

### Task 2: Migration 097 — the two email-link RPCs

**Files:**
- Create: `supabase/migrations/097_email_link_rpcs.sql`
- Test: none (probes live in the file)

**Interfaces:**
- Consumes: `companion.persons.email`, `companion.clients.email`, `companion.person_links.link_method` (Task 1); `companion.is_participant_or_decision_maker(uuid)` (migration 081).
- Produces:
  - `public.email_link_candidate_for(p_client_id uuid) returns jsonb` — `null`, or `{"ambiguous": true}`, or `{"person_id": "<uuid>", "first_name": "<text>", "last_initial": "<text>", "dob": "<date or null>", "org_name": "<text>"}`. Task 9's `EmailLinkCard` calls it via `supabase.rpc('email_link_candidate_for', { p_client_id })`.
  - `public.confirm_email_link(p_target_client_id uuid) returns void` — raises `not_authorised` (SQLSTATE 42501), `no_matching_email`, `ambiguous_email_match`, `target_email_mismatch`, `foreign_recipient_login`, `cannot_link_to_self`, or `target_already_linked`. Task 9 calls it via `supabase.rpc('confirm_email_link', { p_target_client_id })` and maps every one of those codes to user copy.

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/097_email_link_rpcs.sql` with exactly this content:

```sql
-- ═══════════════════════════════════════════════════════════════════
-- 097 · Unified invite & email auto-link, step 2 — the RPCs
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
-- WHY THE SOURCE LOOKUP EXCLUDES THE TARGET'S OWN PERSON: 096's
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

-- I1 · 096 must be applied first — all three columns must be present.
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
--      immediately after 096 (nothing has written emails yet).
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

  -- Rule 4 disclosure ceiling: first name, last initial, dob, org name.
  return jsonb_build_object(
    'person_id',    v_person.id,
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
  values (v_org_a, '__097_source_test__', 'probe@example.com', true)
  returning id, person_id into v_client_a, v_person_a;

  insert into companion.clients (org_id, full_name, email, active)
  values (v_org_b, '__097_target_test__', 'probe@example.com', true)
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
--      carries email (096's change), and both plans' journals
--      re-isolate.
```

- [ ] **Step 2: Verify the file parses mechanically**

Run: `node -e "const s=require('fs').readFileSync('supabase/migrations/097_email_link_rpcs.sql','utf8'); const n=(s.match(/\$\$/g)||[]).length; if(n%2) throw new Error('unbalanced $$ delimiters: '+n); if(!s.includes('grant execute on function')) throw new Error('missing grants'); console.log('ok: '+n+' $$ delimiters, grants present')"`

Expected: `ok: 6 $$ delimiters, grants present`

- [ ] **Step 3: Hand the SQL to David**

Paste the whole file into chat. Ask him to run INSPECT → migration → V1/V2/V3. V4–V11 need real accounts and are run later, alongside Task 11's QA runbook.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/097_email_link_rpcs.sql
git commit -m "Add email_link_candidate_for and confirm_email_link RPCs

Mirrors 081's code-link machinery for the email path: the card reads a
minimum-disclosure candidate, the commit repoints the target drawer
onto the pre-existing person and records link_method='email'. Both
lookups exclude the target's own person, because 096's trigger stamps
the same email there and would otherwise make every acceptance-flow
merge ambiguous; the absorbed person's email is cleared for the same
reason on the next merge. foreign_recipient_login replaces the code
flow's possession-of-token proof, which email has no analogue for."
```

---

### Task 3: `offer-email-link` edge function

**Files:**
- Create: `supabase/functions/offer-email-link/index.ts`
- Test: none

**Interfaces:**
- Consumes: `companion.persons.email` and `companion.clients.org_id` (Task 1).
- Produces: an edge function invoked as `supabase.functions.invoke('offer-email-link', { body: { org_id: string, email: string, participant_name: string } })`, always resolving `{ ok: true }`. Tasks 5 and 6 call it fire-and-forget.

- [ ] **Step 1: Read the pattern source fresh**

Read `supabase/functions/invite-member/index.ts` in full before writing. The new function is a pattern-clone of its JWT verification, admin client construction, Resend call, `escapeHtml`, and `buildEmail` styling — not a paraphrase of them.

- [ ] **Step 2: Create the function**

Create `supabase/functions/offer-email-link/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Rule 1 of the linking spec: no cross-tenant search, ever. The caller
// supplies an email and learns NOTHING back — this function returns
// { ok: true } on every path, including "no match", "several matches",
// "email send failed" and "bad input". Any divergence in the response
// body, status code, or timing-visible branching would turn the
// add-participant form into an oracle for "does this person exist
// somewhere else on Companion". Keep every return byte-identical.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const ok = () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return ok()

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!
    const resendKey   = Deno.env.get('RESEND_API_KEY')!
    const appUrl      = Deno.env.get('APP_URL')    ?? 'https://companion.myappbuddy.com.au'
    const fromEmail   = Deno.env.get('FROM_EMAIL') ?? 'Companion <noreply@myappbuddy.com.au>'

    // Verify the calling user's JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      db: { schema: 'companion' },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return ok()

    const { org_id, email, participant_name } = await req.json()
    const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
    if (!org_id || !trimmedEmail) return ok()

    const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'companion' } })

    // The caller must be acting inside their own org.
    const { data: caller } = await admin
      .from('profiles')
      .select('org_id')
      .eq('id', user.id)
      .single()
    if (caller?.org_id !== org_id) return ok()

    // Cross-org match. The `clients!inner(org_id)` + `.neq` pair is
    // load-bearing: the participant this call is ABOUT has just been
    // created with this same email, so 096's trigger already stamped it
    // onto a brand-new person. A naive `persons.email = X` therefore
    // always finds at least two rows and this function would never send
    // anything. Filtering the embedded clients to other orgs drops the
    // just-created person, whose only enrolment is in org_id.
    const { data: matches, error: matchErr } = await admin
      .from('persons')
      .select('id, full_name, dob, clients!inner(org_id)')
      .eq('email', trimmedEmail)
      .neq('clients.org_id', org_id)
      .limit(2)

    // 0 matches, >1 matches (shared household email), or a read error:
    // send nothing. Ambiguity falls back to the manual code flow, which
    // the account holder can start themselves from their own dashboard.
    if (matchErr || !matches || matches.length !== 1) return ok()

    const { data: org } = await admin
      .from('organisations')
      .select('name')
      .eq('id', org_id)
      .single()

    const orgName  = org?.name ?? 'a Companion plan'
    const partName = (typeof participant_name === 'string' && participant_name.trim())
      || 'a participant'

    // The email body discloses ONLY the new plan's name and the
    // participant's name (spec §7). The minimum-disclosure preview of
    // the OTHER record happens post-sign-in, in the card, server-
    // enforced by email_link_candidate_for.
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: [trimmedEmail],
        subject: `${partName} has been added to a plan at ${orgName}`,
        html: buildEmail({ appUrl, orgName, participantName: partName }),
      }),
    })

    return ok()
  } catch {
    return ok()
  }
})

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildEmail({ appUrl, orgName, participantName }: {
  appUrl: string
  orgName: string
  participantName: string
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>A new plan on Companion</title>
</head>
<body style="margin:0;padding:0;background:#f6f2ea;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#2f2c26;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f2ea;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffefb;border-radius:18px;overflow:hidden;box-shadow:0 2px 16px rgba(47,44,38,0.08);">
        <tr>
          <td style="background:#6f8c78;padding:28px 32px;">
            <p style="margin:0;font-size:22px;font-weight:600;color:#fff;font-family:Georgia,serif;">Companion</p>
            <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.75);letter-spacing:0.1em;text-transform:uppercase;font-family:monospace;">Care journal</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 32px 24px;">
            <h1 style="margin:0 0 12px;font-size:24px;font-weight:400;font-family:Georgia,serif;color:#2f2c26;">A new plan on Companion</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#2f2c26;">
              <strong>${escapeHtml(participantName)}</strong> has been added to a plan at
              <strong>${escapeHtml(orgName)}</strong>, using this email address.
              If you already use Companion, you can link the two records so everything
              shows up in one place — sign in and look for the link offer on your journal.
            </p>
            <a href="${appUrl}/"
               style="display:inline-block;background:#6f8c78;color:#fff;text-decoration:none;padding:14px 28px;border-radius:12px;font-size:15px;font-weight:600;margin-bottom:24px;">
              Sign in to Companion →
            </a>
            <p style="margin:0;font-size:12px;color:#8a8273;line-height:1.6;">
              Button not working? Copy this link:<br>
              <a href="${appUrl}/" style="color:#4d6655;word-break:break-all;">${appUrl}/</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #ede9e0;">
            <p style="margin:0;font-size:12px;color:#8a8273;line-height:1.5;">
              If this wasn't expected, you can ignore this email — nothing has been linked, and
              nothing will be unless you confirm it while signed in.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
```

- [ ] **Step 3: Type-check the whole app still builds**

The function is Deno, not part of the Vite build, so it cannot break `tsc`. Confirm nothing else regressed anyway.

Run: `npm run build`
Expected: exit 0, `dist/` written.

- [ ] **Step 4: Give David the deploy instruction**

This function needs no entitlement check (the coordinator is acting within their own plan, and participant-side linking is free exactly as the code flow is), but it DOES need to be reachable without a Supabase user JWT gate mismatch. It is called from the app with a real user JWT, so leave `verify_jwt` at its default `true` — do not deploy with `--no-verify-jwt`.

Tell David: create `offer-email-link` in the Supabase dashboard (Edge Functions → Deploy a new function), paste the single file, and confirm `RESEND_API_KEY`, `APP_URL` and `FROM_EMAIL` are already set as project secrets (they are — `invite-member` uses the same three). Do not paste any key value into chat.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/offer-email-link/index.ts
git commit -m "Add offer-email-link edge function

Sends the account holder a recognition email when a coordinator adds a
participant whose email uniquely matches a person in a different org.
Returns { ok: true } on every path so the coordinator's response is
byte-identical whether or not a match existed — rule 1 forbids the
add-participant form becoming an existence oracle. The cross-org filter
on the embedded clients row is required, not an optimisation: the
just-created participant already carries the same email via 096's
trigger, so an unfiltered lookup always finds two and never sends."
```

---

### Task 4: Wording cleanup — "care recipient" → participant

**Files:**
- Modify: `src/pages/auth/AcceptInvite.tsx:23`
- Modify: `src/pages/members/MembersPage.tsx:22`
- Modify: `supabase/functions/invite-member/index.ts:13`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing structural — copy only. Task 7 defines its own `ROLE_LABEL` and must use the same `'Participant'` label.

- [ ] **Step 1: Change the three labels**

In `src/pages/auth/AcceptInvite.tsx`, inside the `ROLE_LABEL` map:

```ts
  recipient:              'Participant',
```

In `src/pages/members/MembersPage.tsx`, inside the `ROLE_LABEL` map:

```ts
  recipient: 'Participant',
```

In `supabase/functions/invite-member/index.ts`, inside its `ROLE_LABEL` map:

```ts
  recipient: 'participant',
```

(lowercase — that map is interpolated mid-sentence into email copy: "as a **participant**".)

- [ ] **Step 2: Find any remaining live-copy hits**

Run: `npx --yes rg -in "care recipient" src supabase/functions`

Expected: only `src/pages/ReleaseNotes.tsx` matches remain. Those are historical release-note entries describing what shipped at the time — leave them alone; rewriting shipped history is not a wording cleanup. `src/pages/setup/Step3Team.tsx` has no hit (verified 2026-08-31 — it only offers Support Worker / Coordinator).

If the command surfaces a hit in any other file under `src/` or `supabase/functions/`, fix it the same way, preferring "participant" for the noun and "participant login" where the sentence is about the account.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/pages/auth/AcceptInvite.tsx src/pages/members/MembersPage.tsx supabase/functions/invite-member/index.ts
git commit -m "Rename care recipient to participant in user-facing copy

One user-facing concept. The clients row and the recipient engine role
both stay as they are — only the words people read change. Historical
release-note entries keep their original wording."
```

---

### Task 5: Email + login-invite on the coordinator add-participant form

**Files:**
- Modify: `src/pages/setup/Step4Clients.tsx`
- Test: manual QA (below)

**Interfaces:**
- Consumes: `companion.clients.email` (Task 1); `offer-email-link` (Task 3); the existing `invite-member` edge function; `useFeatures()` and `FEATURES.recipientLogin` from `src/hooks/useFeatures.ts` / `src/lib/features.ts`.
- Produces: nothing other tasks read.

- [ ] **Step 1: Read the file fresh**

Read `src/pages/setup/Step4Clients.tsx` in full. It is ~180 lines; the changes touch the imports, the state block, `addClient()`, and the form markup.

- [ ] **Step 2: Add the imports**

Alongside the existing imports at the top of the file:

```ts
import { useFeatures } from '../../hooks/useFeatures'
import { FEATURES } from '../../lib/features'
```

- [ ] **Step 3: Add the state and the feature check**

Immediately after the existing `const [dob, setDob] = useState('')`:

```ts
  const [email, setEmail] = useState('')
  const [sendInvite, setSendInvite] = useState(false)
  const [notice, setNotice] = useState('')
```

And alongside the existing `const { user, profile, org } = useAuth()` line:

```ts
  const { has } = useFeatures()
```

- [ ] **Step 4: Replace `addClient()` with the version that stores email and fires the two calls**

Replace the whole existing `addClient` function with:

```ts
  async function addClient() {
    setError('')
    setNotice('')
    if (!name.trim()) return
    if (!orgId) {
      setError('Organisation not loaded yet — wait a moment and try again.')
      return
    }
    if (capReached) {
      setError(`You've reached your plan's limit of ${seats} participant${seats === 1 ? '' : 's'}. Increase your plan quantity to add more.`)
      return
    }
    setSaving(true)
    const trimmedEmail = email.trim().toLowerCase()
    const { data: inserted, error: err } = await supabase
      .from('clients')
      .insert({
        org_id: orgId,
        full_name: name.trim(),
        dob: dob || null,
        email: trimmedEmail || null,
        active: true,
      })
      .select('id')
      .single()

    if (err || !inserted) {
      setSaving(false)
      // The DB trigger is the real enforcement — this fires if the client-side
      // check above was stale (e.g. org.seats hadn't synced yet this session).
      setError(
        (err?.message ?? '').includes('Participant seat limit reached')
          ? `You've reached your plan's limit of ${seats ?? 'your plan\'s'} participant${seats === 1 ? '' : 's'}. Increase your plan quantity to add more.`
          : (err?.message ?? 'Could not add participant.')
      )
      return
    }

    // The participant record is saved. Everything below is best-effort:
    // a failed invite or a failed recognition email must never read as a
    // failed add, because the record is already there.
    if (sendInvite && trimmedEmail && has(FEATURES.recipientLogin)) {
      const { data: inviteData, error: inviteErr } = await supabase.functions.invoke('invite-member', {
        body: {
          email: trimmedEmail,
          name: name.trim(),
          role: 'recipient',
          org_id: orgId,
          client_id: inserted.id,
        },
      })
      if (inviteErr || !inviteData?.ok) {
        setNotice(`${name.trim()} was added, but the login invite could not be sent. You can send it later from their participant page.`)
      }
    }

    // Fire-and-forget: the response is byte-identical whether or not a
    // match existed, so there is nothing to branch on and nothing to
    // show the coordinator either way (rule 1).
    if (trimmedEmail) {
      supabase.functions
        .invoke('offer-email-link', {
          body: { org_id: orgId, email: trimmedEmail, participant_name: name.trim() },
        })
        .catch(() => {})
    }

    setSaving(false)
    qc.invalidateQueries({ queryKey: ['clients', orgId] })
    setAdded((prev) => [...prev, name.trim()])
    setActiveCount((prev) => (prev ?? 0) + 1)
    setName('')
    setDob('')
    setEmail('')
    setSendInvite(false)
  }
```

- [ ] **Step 5: Add the email field and checkbox to the form**

Inside the `<div className="card">` block, immediately after the existing date-of-birth `field` div and before the "Add participant" button:

```tsx
          <div className="field" style={{ marginBottom: '0.75rem' }}>
            <label htmlFor="clientEmail">
              Email address <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
            </label>
            <input
              id="clientEmail"
              type="email"
              className="input"
              placeholder="their@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
              Used if you invite them to log in, and to recognise them if they already use Companion elsewhere.
            </p>
          </div>

          {has(FEATURES.recipientLogin) && (
            <div className="field" style={{ marginBottom: '1rem' }}>
              <label htmlFor="clientSendInvite" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400 }}>
                <input
                  id="clientSendInvite"
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  disabled={!email.trim()}
                />
                Send them a login invite now
              </label>
            </div>
          )}
```

- [ ] **Step 6: Render the soft notice**

Immediately after the existing `{error && (...)}` block near the top of the returned markup:

```tsx
      {notice && (
        <div className="alert" style={{ marginBottom: '1rem' }}>
          {notice}
        </div>
      )}
```

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 8: Manual QA**

Run: `npm run dev`, sign in as a coordinator, go to `/setup/clients`, and check:
1. Adding a participant with no email works exactly as before.
2. Adding one with an email stores it — confirm with `select full_name, email from companion.clients order by created_at desc limit 1;` (hand this to David; the app has no way to show it yet).
3. With `recipient_login` in the plan, ticking the checkbox sends the invite email.
4. Without `recipient_login`, the checkbox does not render at all and no invite is attempted.
5. The checkbox is disabled until an email is typed.

- [ ] **Step 9: Commit**

```bash
git add src/pages/setup/Step4Clients.tsx
git commit -m "Collect an email and optional login invite when adding a participant

The email is the match key the auto-link flow needs, so it belongs on
the participant form rather than being discoverable only through an
invite. Both follow-on calls are best-effort: the record is already
saved by the time either runs, so a failed invite shows a soft notice
and a failed recognition email shows nothing at all."
```

---

### Task 6: Email + login-invite on the family-plan first step

**Files:**
- Modify: `src/pages/setup/family/FamilyStep1Participant.tsx`
- Test: manual QA (below)

**Interfaces:**
- Consumes: same as Task 5 — `companion.clients.email`, `offer-email-link`, `invite-member`, `useFeatures()`.
- Produces: nothing other tasks read.

- [ ] **Step 1: Read the file fresh**

Read `src/pages/setup/family/FamilyStep1Participant.tsx` in full (~76 lines). Note that `setup_family_org` is an RPC that creates the org AND the client in one call and returns `{ ok, org_id, client_id }` — the email cannot be passed into it without changing the RPC, so it is stamped on afterwards.

- [ ] **Step 2: Add the imports**

```ts
import { useFeatures } from '../../../hooks/useFeatures'
import { FEATURES } from '../../../lib/features'
```

- [ ] **Step 3: Add the state and the feature check**

After the existing `const [name, setName] = useState('')`:

```ts
  const [email, setEmail] = useState('')
  const [sendInvite, setSendInvite] = useState(false)
```

And after the existing `const { user, profile, refreshProfile } = useAuth()`:

```ts
  const { has } = useFeatures()
```

- [ ] **Step 4: Replace `handleContinue()`**

Replace the whole existing `handleContinue` function with:

```ts
  async function handleContinue() {
    if (!name.trim() || !user) return
    setSaving(true)
    setError('')
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('setup_family_org', {
        p_participant_name: name.trim(),
      })
      if (rpcError) throw rpcError
      // Register the free family plan as a real MAB subscription so its
      // entitlements resolve like any other plan. Best-effort — don't block.
      const result = rpcData as { org_id?: string; client_id?: string } | null
      const orgId = result?.org_id
      const clientId = result?.client_id
      if (orgId && user.email) {
        await ensureFreeFamilySubscription({ email: user.email, name: profile?.full_name ?? '', orgId })
      }
      await refreshProfile()

      // Stamp the email on afterwards: setup_family_org creates the client
      // itself and takes no email parameter. This runs AFTER refreshProfile
      // so the caller's my_org_id() resolves to the org that was just
      // created — before that, RLS on clients rejects the update.
      const trimmedEmail = email.trim().toLowerCase()
      if (clientId && trimmedEmail) {
        const { error: stampErr } = await supabase
          .from('clients')
          .update({ email: trimmedEmail })
          .eq('id', clientId)
          .select('id')
          .single()
        if (stampErr) console.error('[FamilyStep1] could not store participant email:', stampErr)

        if (sendInvite && orgId && has(FEATURES.recipientLogin)) {
          supabase.functions
            .invoke('invite-member', {
              body: {
                email: trimmedEmail,
                name: name.trim(),
                role: 'recipient',
                org_id: orgId,
                client_id: clientId,
              },
            })
            .catch(() => {})
        }

        supabase.functions
          .invoke('offer-email-link', {
            body: { org_id: orgId, email: trimmedEmail, participant_name: name.trim() },
          })
          .catch(() => {})
      }

      navigate('/setup/family/invite')
    } catch (e) {
      setError(errorMessage(e, 'Something went wrong. Please try again.'))
    } finally {
      setSaving(false)
    }
  }
```

- [ ] **Step 5: Add the form fields**

Immediately after the existing "Their name" `field` div and before the Continue button:

```tsx
      <div className="field" style={{ marginBottom: '1rem' }}>
        <label htmlFor="participant-email">
          Their email address <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
        </label>
        <input
          id="participant-email"
          type="email"
          className="input"
          placeholder="their@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
          Only needed if they'll have their own login, or already use Companion with another plan.
        </p>
      </div>

      {has(FEATURES.recipientLogin) && (
        <div className="field" style={{ marginBottom: '1.5rem' }}>
          <label htmlFor="participant-send-invite" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 400 }}>
            <input
              id="participant-send-invite"
              type="checkbox"
              checked={sendInvite}
              onChange={e => setSendInvite(e.target.checked)}
              disabled={!email.trim()}
            />
            Send them a login invite now
          </label>
        </div>
      )}
```

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 7: Manual QA**

Run: `npm run dev` and sign up a fresh family-plan account:
1. Continuing with no email behaves exactly as before.
2. Continuing with an email lands on step 2 without visible delay, and `select email from companion.clients where id = '<the new client id>';` shows it (hand to David).
3. A failure to stamp the email logs to the console and still navigates — it must never block setup.

- [ ] **Step 8: Commit**

```bash
git add src/pages/setup/family/FamilyStep1Participant.tsx
git commit -m "Collect the participant's email during family-plan setup

setup_family_org creates the client itself and takes no email
parameter, so the email is stamped on afterwards — deliberately after
refreshProfile, because until the new membership is in context RLS on
clients rejects the update. A failed stamp logs and continues; setup
must never be blocked by an optional field."
```

---

### Task 7: Extract the one unified invite modal

**Files:**
- Create: `src/components/InviteMemberModal.tsx`
- Modify: `src/pages/members/MembersPage.tsx`
- Test: manual QA (below)

**Interfaces:**
- Consumes: `supabase.functions.invoke('invite-member', ...)`; `buildSmsLink` from `src/lib/smsLink`; `useModalOpen` from `src/context/ModalActivityContext`.
- Produces: `export default function InviteMemberModal(props)` and `export type SubRole = { id: string; name: string; is_default: boolean }`. Props:
  ```ts
  {
    orgId: string
    allowedRoles: string[]
    clients: { id: string; full_name: string }[]
    subRoles: SubRole[]
    onClose: () => void
    pinnedRole?: string
    pinnedClientId?: string
    initialEmail?: string
    onSent?: (email: string) => void
  }
  ```
  Tasks 8 and 10 both mount it.

- [ ] **Step 1: Create the component**

Create `src/components/InviteMemberModal.tsx`:

```tsx
import { useState } from 'react'
import { useModalOpen } from '../context/ModalActivityContext'
import { supabase } from '../lib/supabase'
import { buildSmsLink } from '../lib/smsLink'

export type SubRole = { id: string; name: string; is_default: boolean }

const ROLE_LABEL: Record<string, string> = {
  coordinator: 'Coordinator',
  family: 'Family member',
  recipient: 'Participant',
  trusted_support_worker: 'Trusted worker',
  support_worker: 'Support worker',
  therapist: 'Therapist',
}

// The plain-language "Who is this person?" picker. Hints say what the
// role can actually SEE and DO, because "family member" vs "support
// worker" is not what a coordinator is deciding between — access is.
const ROLE_CHOICES: { value: string; label: string; hint: string }[] = [
  { value: 'recipient', label: 'The participant themselves', hint: 'Gives the person being supported their own login — they can see and add to the care journal.' },
  { value: 'family', label: 'Family member', hint: 'Adds journal entries and can see the care journal.' },
  { value: 'support_worker', label: 'Support worker', hint: 'Logs shifts and entries, behaviour notes and shift notes.' },
  { value: 'therapist', label: 'Therapist', hint: 'Sees shared notes and adds goals.' },
]

// Roles whose invite is scoped to a participant. 'family'/'recipient' MUST
// name one (a family member or a participant login belongs to exactly one
// participant). Workers CAN optionally be assigned at invite time — they may
// serve several participants over time, so this is just a convenient first
// assignment; more are added later from that participant's "Assigned
// workers" panel. A single-client org has nothing to pick, so no picker
// shows there either way.
const REQUIRED_CLIENT_ROLES = new Set(['family', 'recipient'])
const OPTIONAL_CLIENT_ROLES = new Set(['support_worker', 'trusted_support_worker'])

export default function InviteMemberModal({
  orgId,
  allowedRoles,
  clients,
  subRoles,
  onClose,
  pinnedRole,
  pinnedClientId,
  initialEmail,
  onSent,
}: {
  orgId: string
  allowedRoles: string[]
  clients: { id: string; full_name: string }[]
  subRoles: SubRole[]
  onClose: () => void
  /** Fixes the role — the picker is hidden entirely. */
  pinnedRole?: string
  /** Fixes the participant — the client picker is hidden entirely. */
  pinnedClientId?: string
  initialEmail?: string
  /** Called with the email actually invited, after a successful send. */
  onSent?: (email: string) => void
}) {
  useModalOpen()
  const [name, setName] = useState('')
  const [email, setEmail] = useState(initialEmail ?? '')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState(pinnedRole ?? allowedRoles[0] ?? 'support_worker')
  const [subRoleId, setSubRoleId] = useState('')
  const [selectedClientId, setSelectedClientId] = useState(clients[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [sent, setSent] = useState(false)
  const [sentInviteUrl, setSentInviteUrl] = useState<string | null>(null)
  const [fallbackLink, setFallbackLink] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const required = REQUIRED_CLIENT_ROLES.has(role)
  const optional = OPTIONAL_CLIENT_ROLES.has(role)
  // A pinned participant satisfies every client requirement on its own —
  // callers that pin one (a participant's own page, family setup) pass
  // clients={[]} and must not be told to "add a participant first".
  const needsClientPicker = !pinnedClientId && (required || optional) && clients.length > 1
  const noClients = !pinnedClientId && required && clients.length === 0
  const clientId = pinnedClientId
    ?? (needsClientPicker
      ? (selectedClientId || null)
      : (clients.length === 1 ? clients[0].id : null))

  // Only offer a choice when there is genuinely one to make.
  const showRolePicker = !pinnedRole && allowedRoles.length > 1
  const roleChoices = allowedRoles.map((r) => {
    const known = ROLE_CHOICES.find((c) => c.value === r)
    return known ?? { value: r, label: ROLE_LABEL[r] ?? r, hint: '' }
  })
  const activeHint = roleChoices.find((c) => c.value === role)?.hint ?? ''

  async function handleInvite() {
    if (!name.trim() || !email.trim()) return
    if (required && !clientId) { setErr('Choose which participant this is for.'); return }
    setSaving(true)
    setErr('')
    const trimmedEmail = email.trim()
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: {
        name: name.trim(), email: trimmedEmail, phone: phone.trim() || null, role, org_id: orgId,
        client_id: clientId, sub_role_id: role === 'support_worker' ? (subRoleId || null) : null,
      },
    })
    setSaving(false)
    if (error || !data?.ok) {
      setErr(data?.error ?? error?.message ?? 'Failed to send invite')
      if (data?.inviteUrl) setFallbackLink(data.inviteUrl)
      return
    }
    setSentInviteUrl(data.inviteUrl ?? null)
    setSent(true)
    onSent?.(trimmedEmail)
  }

  if (sent) {
    const smsHref = phone.trim() && sentInviteUrl
      ? buildSmsLink(phone.trim(), `You've been invited to join Companion — tap to accept: ${sentInviteUrl}`)
      : null
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, textAlign: 'center' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>✉️</div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 400, marginBottom: '0.5rem' }}>Invite sent</h2>
          <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)', marginBottom: '1.5rem' }}>
            An email has been sent to <strong>{name}</strong> ({email}).<br />
            They'll click the link, create a password, and land straight in the journal.
          </p>
          {smsHref && (
            <a href={smsHref} className="btn btn-secondary btn-full" style={{ marginBottom: '0.75rem' }}>
              📱 Also text the invite to {phone.trim()}
            </a>
          )}
          <button className="btn btn-primary btn-full" onClick={onClose}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Invite member</p>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 400, marginBottom: '1.25rem' }}>Send an invitation</h2>

        {err && (
          <div style={{ marginBottom: '1rem' }}>
            <div className="alert alert-error">{err}</div>
            {fallbackLink && (
              <div style={{ marginTop: '0.75rem' }}>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.4rem' }}>
                  Share this link manually instead:
                </p>
                <div style={{
                  background: 'var(--color-surface)', borderRadius: 8,
                  padding: '0.6rem 0.75rem', fontSize: '0.75rem', wordBreak: 'break-all',
                  border: '1px solid var(--color-border)', marginBottom: '0.4rem',
                }}>
                  {fallbackLink}
                </div>
                <button className="btn btn-ghost" style={{ fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                  onClick={() => navigator.clipboard.writeText(fallbackLink!).catch(() => {})}>
                  Copy link
                </button>
              </div>
            )}
          </div>
        )}

        {showRolePicker && (
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="invite-role">Who is this person?</label>
            <select id="invite-role" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
              {roleChoices.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
            {activeHint && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
                {activeHint}
              </p>
            )}
          </div>
        )}

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="invite-name">Their name</label>
          <input id="invite-name" className="input" placeholder="e.g. Sarah Younger"
            value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="invite-email">Email address</label>
          <input id="invite-email" type="email" className="input" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>

        <div className="field" style={{ marginBottom: '1rem' }}>
          <label htmlFor="invite-phone">
            Mobile number <span style={{ fontWeight: 400, color: 'var(--color-muted)' }}>(optional)</span>
          </label>
          <input id="invite-phone" type="tel" className="input" placeholder="04xx xxx xxx"
            value={phone} onChange={(e) => setPhone(e.target.value)} />
          <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
            The invite is always emailed. Add a number to also get a one-tap link for texting it yourself.
          </p>
        </div>

        {role === 'support_worker' && subRoles.length > 0 && (
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="invite-sub-role">Support worker type</label>
            <select id="invite-sub-role" className="input" value={subRoleId} onChange={(e) => setSubRoleId(e.target.value)}>
              {subRoles.map((sr) => (
                <option key={sr.id} value={sr.id}>{sr.name}{sr.is_default ? ' (default)' : ''}</option>
              ))}
            </select>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
              Sets which permissions this worker starts with — manage types in Settings → Permissions.
            </p>
          </div>
        )}

        {needsClientPicker && (
          <div className="field" style={{ marginBottom: '1rem' }}>
            <label htmlFor="invite-client">
              {required ? 'Which participant is this for?' : 'Assign to a participant (optional)'}
            </label>
            <select id="invite-client" className="input" value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}>
              {optional && <option value="">— assign later —</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.full_name}</option>
              ))}
            </select>
            {optional && (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
                Workers can be assigned to more participants later from each participant's page.
              </p>
            )}
          </div>
        )}
        {noClients && (
          <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
            Add a participant before inviting their {role === 'recipient' ? 'own login' : 'family'}.
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="btn btn-primary" onClick={handleInvite}
            disabled={saving || !name.trim() || !email.trim() || noClients} style={{ flex: 2 }}>
            {saving ? <span className="spinner" /> : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Point MembersPage at it**

In `src/pages/members/MembersPage.tsx`:

Add to the imports:

```ts
import InviteMemberModal, { type SubRole } from '../../components/InviteMemberModal'
```

Delete the local `type SubRole = { id: string; name: string; is_default: boolean }` declaration (it now comes from the import), and delete the local `REQUIRED_CLIENT_ROLES` / `OPTIONAL_CLIENT_ROLES` constants and the entire local `function InviteModal({ ... }) { ... }` definition — from `function InviteModal({` through its closing `}` immediately before `export default function MembersPage()`.

Replace the usage at the bottom of `MembersPage`:

```tsx
      {showInvite && org && (
        <InviteMemberModal
          orgId={org.id}
          allowedRoles={invitableRoles}
          clients={orgClients}
          subRoles={subRoles}
          onClose={() => {
            setShowInvite(false)
            qc.invalidateQueries({ queryKey: ['org-members'] })
            qc.invalidateQueries({ queryKey: ['pending-invites'] })
          }}
        />
      )}
```

Keep the `useModalOpen` import — `EditMemberModal` in the same file still uses it. Keep `buildSmsLink` — the pending-invites list still uses it. Keep the file's own `ROLE_LABEL` (with Task 4's `'Participant'`) — the role badges and section headings read from it.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exit 0. A `TS6133` unused-variable error here means a leftover import from the deleted modal — remove it rather than suppressing it.

- [ ] **Step 4: Manual QA**

Run: `npm run dev`, sign in as a coordinator, open Members → Invite:
1. The "Who is this person?" picker shows plain-language labels with a hint beneath the selection, and the hint changes as the selection changes.
2. Inviting a support worker with a sub-role still attaches the sub-role.
3. In a multi-participant org, choosing "Family member" still shows the participant picker; in a single-participant org it does not.
4. Sending still shows the "Invite sent" panel and the SMS link when a phone number was entered.

- [ ] **Step 5: Commit**

```bash
git add src/components/InviteMemberModal.tsx src/pages/members/MembersPage.tsx
git commit -m "Extract one unified invite modal with a plain-language role picker

Coordinators were choosing between internal role names; the picker now
asks who the person is and says what each choice can see and do. The
modal moves out of MembersPage so the participant page and family setup
can mount the same form instead of each growing their own, with
pinnedRole/pinnedClientId for the callers that already know the answer."
```

---

### Task 8: "Invite to log in" on the participant page

**Files:**
- Modify: `src/components/ClientManagePanel.tsx`
- Test: manual QA (below)

**Interfaces:**
- Consumes: `InviteMemberModal` (Task 7); `companion.clients.email` (Task 1); `useFeatures()` / `FEATURES.recipientLogin` (already imported in this file).
- Produces: nothing other tasks read.

- [ ] **Step 1: Read the file fresh**

Read `src/components/ClientManagePanel.tsx` in full. It was 443 lines as of 2026-08-31; the concurrent session may have changed it, so anchor the edits on the surrounding text quoted below rather than on line numbers.

- [ ] **Step 2: Add the import and state**

Alongside the other component imports at the top:

```ts
import InviteMemberModal from './InviteMemberModal'
```

Alongside the other `useState` calls near the top of the component body (next to `const [showBspForm, setShowBspForm] = useState(false)`):

```ts
  const [showInviteLogin, setShowInviteLogin] = useState(false)
```

- [ ] **Step 3: Add `email` to the client query**

In the `['client-manage', clientId]` query, change the select list:

```ts
        .select('decision_maker_id, decision_maker_kind, recipient_profile_id, email')
```

- [ ] **Step 4: Insert the "Participant login" section**

Between the Decision maker section's closing `</div>` (the one right after the `{saveDecisionMaker.isSuccess && (...)}` block) and the `<div style={{ marginBottom: '1.5rem' }}>` that opens "Assigned workers", insert:

```tsx
      {has(FEATURES.recipientLogin) && !client?.recipient_profile_id && (
        <div style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Participant login</p>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
            {participantName} doesn't have their own login yet. Inviting them lets them see and add to their own care journal.
          </p>
          <button className="btn btn-secondary" style={{ fontSize: '0.8rem' }}
            onClick={() => setShowInviteLogin(true)}>
            Invite to log in
          </button>
        </div>
      )}

      {showInviteLogin && (
        <InviteMemberModal
          orgId={orgId}
          allowedRoles={['recipient']}
          clients={[{ id: clientId, full_name: participantName }]}
          subRoles={[]}
          pinnedRole="recipient"
          pinnedClientId={clientId}
          initialEmail={client?.email ?? ''}
          onClose={() => {
            setShowInviteLogin(false)
            qc.invalidateQueries({ queryKey: ['client-manage', clientId] })
          }}
        />
      )}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 6: Manual QA**

Run: `npm run dev`, sign in as a coordinator, expand a participant's manage panel:
1. On a plan with `recipient_login` and a participant who has no login, the section shows and the button opens the modal with the role hidden (pinned) and the email prefilled from `clients.email` when one is stored.
2. On a participant who already has a login, the section does not render.
3. On a plan without `recipient_login`, the section does not render.
4. Sending the invite closes the modal and does not disturb the rest of the panel.

- [ ] **Step 7: Commit**

```bash
git add src/components/ClientManagePanel.tsx
git commit -m "Add an invite-to-log-in action to the participant page

Sending a participant their own login previously meant leaving their
page for Members and re-picking the participant there. The section
hides itself once a login exists, so it reads as a to-do rather than a
permanent control, and prefills the email already stored on the record."
```

---

### Task 9: The email-link acceptance card

**Files:**
- Create: `src/components/EmailLinkCard.tsx`
- Modify: `src/pages/family/FamilyDashboard.tsx`
- Test: manual QA (below)

**Interfaces:**
- Consumes: `public.email_link_candidate_for(uuid)` and `public.confirm_email_link(uuid)` (Task 2); `errorMessage` from `src/lib/errorMessage`.
- Produces: `export default function EmailLinkCard({ clientId, participantName }: { clientId: string; participantName: string })`. Invalidates the `['linked-drawers']` query key that `PersonLinkPanel` owns, so the panel's "Linked to another plan" state updates in the same render pass.

- [ ] **Step 1: Create the component**

Create `src/components/EmailLinkCard.tsx`:

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errorMessage'

type Candidate =
  | { ambiguous: true }
  | {
      person_id: string
      first_name: string
      last_initial: string
      dob: string | null
      org_name: string
    }

// Every error confirm_email_link can raise, in user words. Nothing here
// leaks an internal reason: `not_authorised` and `target_email_mismatch`
// are both defensive (the card should never have been offered) and both
// point at the manual code flow rather than explaining why.
const CARD_ERRORS: Record<string, string> = {
  ambiguous_email_match: 'This email is used by more than one record. Use the linking panel below to link them instead.',
  no_matching_email: 'We couldn\'t match this to another record. Use the linking panel below to link them instead.',
  not_authorised: 'We couldn\'t link these records automatically. Use the linking panel below to link them instead.',
  target_email_mismatch: 'We couldn\'t link these records automatically. Use the linking panel below to link them instead.',
  foreign_recipient_login: 'We couldn\'t link these records automatically. Use the linking panel below to link them instead.',
  cannot_link_to_self: 'These are the same record — nothing to link.',
  target_already_linked: 'These records are already linked.',
}

function messageFor(e: unknown): string {
  const raw = errorMessage(e, '')
  for (const code of Object.keys(CARD_ERRORS)) {
    if (raw.includes(code)) return CARD_ERRORS[code]
  }
  return 'Could not link the records. Try again, or use the linking panel below.'
}

/**
 * Offers a one-tap link when the signed-in account holder's email is
 * recognised on another Companion plan. Rendered only for the
 * participant or their decision-maker — the server enforces that
 * independently (email_link_candidate_for raises 42501 otherwise), this
 * is just where the UI happens to live, not the security boundary.
 *
 * Renders nothing at all when there is no candidate, when the query
 * errors (a family member without authority over this drawer gets a
 * 42501 — silence is the correct output, not an error card), or when
 * this device has already dismissed it.
 */
export default function EmailLinkCard({ clientId, participantName }: { clientId: string; participantName: string }) {
  const qc = useQueryClient()
  const dismissKey = `email-link-dismissed-${clientId}`
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey) === '1')
  const [error, setError] = useState('')

  const { data: candidate, isError } = useQuery({
    queryKey: ['email-link-candidate', clientId],
    queryFn: async () => {
      const { data, error: rpcError } = await supabase.rpc('email_link_candidate_for', { p_client_id: clientId })
      if (rpcError) throw rpcError
      return (data ?? null) as Candidate | null
    },
    retry: false,
  })

  const confirm = useMutation({
    mutationFn: async () => {
      const { error: rpcError } = await supabase.rpc('confirm_email_link', { p_target_client_id: clientId })
      if (rpcError) throw rpcError
    },
    onSuccess: () => {
      setError('')
      qc.invalidateQueries({ queryKey: ['email-link-candidate', clientId] })
      qc.invalidateQueries({ queryKey: ['linked-drawers'] })
    },
    onError: (e) => setError(messageFor(e)),
  })

  function dismiss() {
    // Per-device, deliberately: no server-side dismissal flag, no
    // migration. Re-appearing on another device or a fresh sign-in is
    // harmless — the offer is still true.
    localStorage.setItem(dismissKey, '1')
    setDismissed(true)
  }

  if (dismissed || isError || !candidate) return null

  if ('ambiguous' in candidate) {
    return (
      <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
        <p style={{ fontSize: '0.85rem', margin: '0 0 0.75rem' }}>
          Your email address is used by more than one record on Companion, so we can't tell which one
          to link. Use the "Link to another plan" panel below to link them with a code instead.
        </p>
        <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={dismiss}>
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="card" style={{ marginBottom: '1rem', padding: '0.875rem 1rem' }}>
      <p style={{ fontSize: '0.85rem', margin: '0 0 0.5rem' }}>
        You already have a record with <strong>{candidate.org_name}</strong> as{' '}
        <strong>{candidate.first_name} {candidate.last_initial}.</strong>
        {candidate.dob && <> Born {new Date(candidate.dob).toLocaleDateString()}.</>}{' '}
        Link them so you see all your plans in one place?
      </p>
      <p style={{ fontSize: '0.78rem', color: 'var(--color-muted)', margin: '0 0 0.75rem' }}>
        Linking merges {participantName}'s journal, goals and photos across both plans for you and your
        family. Each plan's staff still only see their own plan.
      </p>
      {error && <div className="alert alert-error" style={{ marginBottom: '0.5rem' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" style={{ fontSize: '0.8rem' }} onClick={dismiss}>
          Not now
        </button>
        <button className="btn btn-primary" style={{ fontSize: '0.8rem' }}
          disabled={confirm.isPending} onClick={() => confirm.mutate()}>
          {confirm.isPending ? <span className="spinner" /> : 'Yes, link the records'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Mount it in FamilyDashboard**

In `src/pages/family/FamilyDashboard.tsx`, add to the imports next to the existing `PersonLinkPanel` import:

```ts
import EmailLinkCard from '../../components/EmailLinkCard'
```

And directly after the existing `PersonLinkPanel` mount line:

```tsx
        {clientId && <PersonLinkPanel clientId={clientId} participantName={participantName} />}
        {clientId && <EmailLinkCard clientId={clientId} participantName={participantName} />}
```

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Manual QA**

Run: `npm run dev`:
1. As a family member with no matching email anywhere: nothing renders, and the console shows no error.
2. As a recipient whose email matches one other person: the card renders with first name, last initial, DOB and the other plan's name — and nothing more.
3. Confirming makes the card disappear and flips `PersonLinkPanel` to "Linked to another plan" without a page reload.
4. "Not now" hides the card and it stays hidden after a reload on the same device.

- [ ] **Step 5: Record the known precondition gap in the handoff**

Do not fix it in this task — it is pre-existing and out of scope. `FamilyDashboard`'s recipient branch resolves the drawer with:

```ts
        .eq('recipient_profile_id', user!.id)
        .maybeSingle()
```

`maybeSingle()` errors (PostgREST 406) when more than one row matches, and there is no error handling on that query. A recipient with two drawers — exactly the acceptance-flow scenario this card serves — therefore gets `clientId === undefined` and no card at all. The card is mounted regardless, because the mount is correct and the fix belongs to whoever owns that query. Carry this into the Task 11 handoff verbatim.

- [ ] **Step 6: Commit**

```bash
git add src/components/EmailLinkCard.tsx src/pages/family/FamilyDashboard.tsx
git commit -m "Add the one-tap email link card to the journal

Offers the merge at the only moment the account holder can judge it —
signed in, looking at the record. Disclosure is capped server-side by
email_link_candidate_for, so the card shows exactly what it is handed
and nothing more; a query error renders nothing rather than an error,
because for anyone without authority over this drawer the correct
output is silence. Dismissal is per-device on purpose: no flag, no
migration, and a re-offer on another device is still a true offer."
```

---

### Task 10: Family setup step 2 uses the unified modal

**Files:**
- Modify: `src/pages/setup/family/FamilyStep2Invite.tsx`
- Test: manual QA (below)

**Interfaces:**
- Consumes: `InviteMemberModal` (Task 7).
- Produces: nothing other tasks read.

- [ ] **Step 1: Read the file fresh**

Read `src/pages/setup/family/FamilyStep2Invite.tsx` in full (~135 lines).

- [ ] **Step 2: Replace the file's body**

Replace the whole file with:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../context/AuthContext'
import { supabase } from '../../../lib/supabase'
import InviteMemberModal from '../../../components/InviteMemberModal'

export default function FamilyStep2Invite() {
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const [showInvite, setShowInvite] = useState(false)
  const [sent, setSent] = useState<string[]>([])

  // Use distinct key from FamilyDashboard (which selects full_name+dob) to avoid cache collision
  const { data: clientId, isLoading: clientLoading } = useQuery({
    queryKey: ['family-client-id', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('client_family')
        .select('client_id')
        .eq('family_id', user!.id)
        .eq('status', 'active')
        .maybeSingle()
      return data?.client_id ?? null
    },
    enabled: !!user,
  })

  return (
    <div>
      <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Step 2 of 3</p>
      <h1 style={{ fontSize: '1.75rem', fontWeight: 400, marginBottom: '0.5rem' }}>
        Invite family members
      </h1>
      <p style={{ color: 'var(--color-muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
        Anyone you invite can add journal entries. You can also do this later.
      </p>

      {sent.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          {sent.map((e) => (
            <div key={e} className="alert" style={{
              background: 'var(--color-success-bg, #f0fdf4)',
              color: 'var(--color-success, #166534)',
              marginBottom: '0.5rem',
              fontSize: '0.875rem',
            }}>
              Invite sent to {e}
            </div>
          ))}
        </div>
      )}

      <button
        className="btn btn-secondary btn-full"
        onClick={() => setShowInvite(true)}
        disabled={clientLoading || !clientId}
        style={{ marginBottom: '1.5rem' }}
      >
        {clientLoading ? <span className="spinner" /> : '+ Invite a family member'}
      </button>

      <button
        className="btn btn-primary btn-full"
        onClick={() => navigate('/setup/family/done')}
        style={{ fontSize: '1rem' }}
      >
        {sent.length > 0 ? 'Continue →' : 'Skip for now →'}
      </button>

      {showInvite && profile?.org_id && clientId && (
        <InviteMemberModal
          orgId={profile.org_id}
          allowedRoles={['family']}
          clients={[]}
          subRoles={[]}
          pinnedRole="family"
          pinnedClientId={clientId}
          onSent={(email) => setSent((prev) => [...prev, email])}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  )
}
```

The email/sending/error/fallbackLinks state, `sendInvite`, the inline form and the fallback-link rendering are all gone — the modal owns every one of those, including the "email failed, share this link instead" fallback.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Manual QA**

Run: `npm run dev` and walk a fresh family-plan signup to step 2:
1. The invite button is disabled until the participant lookup resolves.
2. Opening it shows no role picker (pinned to family) and no participant picker (pinned to the family's one client).
3. Sending adds a green "Invite sent to …" line and flips the bottom button from "Skip for now" to "Continue".
4. Sending two invites shows two lines.

- [ ] **Step 5: Commit**

```bash
git add src/pages/setup/family/FamilyStep2Invite.tsx
git commit -m "Use the unified invite modal in family setup step 2

The inline form was a third parallel implementation of inviting
someone, and the only one whose email-send failure path had to be
hand-maintained. Pinning the role and participant means the modal shows
just the fields this step actually needs."
```

---

### Task 11: QA runbook, version bump, release notes

**Files:**
- Modify: `package.json:4`
- Modify: `src/pages/ReleaseNotes.tsx`
- Test: the QA runbook below, run by David against dev and then live

**Interfaces:**
- Consumes: everything from Tasks 1–10.
- Produces: the shipped release.

- [ ] **Step 1: Re-check the version before bumping**

The concurrent session bumps `package.json` too. Read it fresh — do not assume 0.5.138 is still current.

Run: `node -p "require('./package.json').version"`
Expected: `0.5.138` (as of 2026-08-31). If it reports something higher, bump from that instead and use the higher number everywhere below.

- [ ] **Step 2: Bump the version**

In `package.json`, line 4:

```json
  "version": "0.5.139",
```

Do not touch `src/lib/version.ts` — it re-exports the build-injected `__APP_VERSION__` from vite's `define`, which reads `package.json`.

- [ ] **Step 3: Add the release-notes entry**

In `src/pages/ReleaseNotes.tsx`, insert as the FIRST element of the `RELEASES` array, above the existing `0.5.138` entry:

```tsx
  {
    version: '0.5.139',
    date: '31 August 2026',
    title: 'One invite form, participant emails, and record linking by email',
    changes: [
      { type: 'new', text: 'You can now record a participant\'s email address when you add them, and optionally send them their own login at the same time — no separate trip to Members.' },
      { type: 'new', text: 'A participant\'s page now has an "Invite to log in" action, which disappears once they have a login.' },
      { type: 'new', text: 'If you already have a record on another Companion plan under the same email address, your journal now offers to link the two so your plans show up in one place. Each plan\'s staff still only ever see their own plan.' },
      { type: 'change', text: 'Every invite now uses the same form, which asks who the person is in plain language — "the participant themselves", "family member", "support worker", "therapist" — and says what each one can see and do. The words "care recipient" are gone from the app.' },
    ],
  },
```

- [ ] **Step 4: Verify the build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Write the QA runbook into the PR description**

The runbook below is the deliverable of this step — paste it into the PR body and hand it to David. It is spec §8's verification, plus the two probes the spec calls out by name.

```markdown
## QA runbook — 0.5.139

### A. Structural (Supabase SQL editor, already run at migration time)
- [ ] 096 V1: `persons.email`, `clients.email`, `person_links.link_method` exist; persons.email has NO unique constraint; the link_method check constraint is present.
- [ ] 096 V2: every pre-existing person_links row reads `link_method = 'code'`.
- [ ] 096 V3: the trigger is `BEFORE INSERT OR UPDATE ... FOR EACH ROW`.
- [ ] 096 V4/V5: insert-carries-email, first-wins on a second differing email, recipient_profile_id promoted, blank email normalised to null.
- [ ] 097 V1/V2: both RPCs SECURITY DEFINER with `search_path=companion,public`; EXECUTE granted to `authenticated`, denied to `anon`.
- [ ] 097 V3: the source lookup excludes the target's own person (1 of 2 matches).

### B. Behavioural — needs real accounts
- [ ] Accept flow sets `clients.email` from the invite when it was null (the card's precondition).
- [ ] Two-plan participant accepts an invite → the card shows first name, last initial, DOB and the other plan's name, and nothing else.
- [ ] Confirm → `client_ids_for_recipient()` returns BOTH enrolments; `person_links` has a row with `link_method='email'` and `link_code_id` null.
- [ ] **PROVIDER ISOLATION PROBE (the hard rule).** After the link, sign in as each plan's coordinator AND as a worker in each plan. Each must still see only their own org's participant row and journal entries. If any of them can see the other plan's rows, STOP and revert — nothing else in this release matters.
- [ ] Coordinator adds a participant with an email that matches an existing person elsewhere → the coordinator's screen is byte-identical to the no-match case; the account holder receives the recognition email; they confirm in-app.
- [ ] Shared / ambiguous household email → the card shows the ambiguous notice, and the manual code flow in "Link to another plan" still works.
- [ ] Chaining refused: email-link onto a target already merged via a code link → "These records are already linked."
- [ ] Foreign participant login on the target → refused (`foreign_recipient_login` → the generic copy).
- [ ] **UNLINK-AFTER-EMAIL-LINK PROBE.** Unlink the email-linked drawer: `person_links.unlinked_at` is set, the fresh snapshot persons row carries `email` (096's change — check it is not null), and both plans' journals re-isolate.
- [ ] The absorbed person's email is null afterwards, so a second merge for the same account holder does not raise `ambiguous_email_match`.
- [ ] Family invite accept → NO card; family merge still goes through `client_family` / `client_ids_for_family()` and does not extend to the other plan's drawer.

### C. Frontend
- [ ] Members → Invite shows the plain-language picker with hints.
- [ ] Participant page shows "Invite to log in" only when the plan includes participant login and the participant has no login yet.
- [ ] Family setup step 2 sends an invite through the shared modal.
- [ ] Add-participant (both provider and family setup) stores the email and honours the checkbox.
- [ ] The word "care recipient" appears nowhere in the app except historical release notes.
- [ ] `npm run build` passes.
```

- [ ] **Step 6: Commit**

```bash
git add package.json src/pages/ReleaseNotes.tsx
git commit -m "Release 0.5.139 — unified invite, participant email, email auto-link

Ships the participant email field, the one invite form, the invite-to-
log-in action, and the email recognition card. Release note leads with
the isolation guarantee, because 'link my records' is exactly the
feature a provider would otherwise assume leaks their journal."
```

- [ ] **Step 7: Open the PR**

Push the feature branch and open a PR against `master` with the QA runbook from Step 5 as the body. Squash-merge only after David has run section B — the provider isolation probe in particular cannot be skipped, and no part of it is checkable from this session.

---

## Self-Review

**1. Spec coverage.**

| Spec section | Covered by |
|---|---|
| §3 one participant concept / wording | Task 4 |
| §4 email on participant + login-invite checkbox | Tasks 5, 6 |
| §4 participant manage panel "Invite to log in" | Task 8 |
| §4 one unified invite modal + "Who is this person?" | Tasks 7, 10 |
| §4 recipient invites stay entitlement-gated | Task 5 Step 4 / Task 8 Step 4 (client-side `has(FEATURES.recipientLogin)`); the server-side backstop in `invite-member` is untouched |
| §5 acceptance-flow card | Task 9 |
| §5 coordinator-path offer | Tasks 3, 5, 6 |
| §5 commit shape + 5 guards | Task 2 |
| §5 ambiguous → manual code flow | Task 9 (`ambiguous` branch points at PersonLinkPanel) |
| §5 family members never auto-link | No task touches `client_family` / `client_ids_for_family()`; Task 11's runbook probes it explicitly |
| §6.1 columns | Task 1 |
| §6.2 trigger extension | Task 1 |
| §6.3 accept_invite | Task 1 |
| §6.4 unlink_person snapshot | Task 1 |
| §6.5 new RPCs | Task 2 |
| §6.6 offer-email-link | Task 3 |
| §6.7 recipient_profile_id promote | Task 1 (included per the approved spec; flagged in the handoff as separable) |
| §7 error copy + dismissal + audit | Task 9 (`CARD_ERRORS`, localStorage), Task 2 (`link_method` on every row) |
| §8 testing plan | Task 11's runbook, plus each migration's own probes |
| §9 rollout order | Task order 1 → 2 → 3 → UI |
| §10 out of scope | No task touches billing, `email_offer_sent_at`, provider-visible RLS, or the `client_family` merge |

No gaps.

**2. Placeholder scan.** No "TBD", no "similar to Task N", no "add error handling" without the code. Every code step carries a complete block. The two `node -e` mechanical checks in Tasks 1 and 2 exist because there is no local Postgres and no test framework — they are real commands with stated expected output, not stand-ins for verification, and the real verification is the migration's own probes run by David.

**3. Type consistency.**
- `email_link_candidate_for` returns `jsonb` in Task 2 and is typed as `Candidate | null` in Task 9 with matching keys (`person_id`, `first_name`, `last_initial`, `dob`, `org_name`, or `{ambiguous: true}`). ✓
- `confirm_email_link(p_target_client_id uuid)` — parameter name matches Task 9's `supabase.rpc('confirm_email_link', { p_target_client_id: clientId })`. ✓
- `email_link_candidate_for(p_client_id uuid)` — matches Task 9's `{ p_client_id: clientId }`. ✓
- Every error string raised in Task 2 (`not_authorised`, `no_matching_email`, `ambiguous_email_match`, `target_email_mismatch`, `foreign_recipient_login`, `cannot_link_to_self`, `target_already_linked`) has a key in Task 9's `CARD_ERRORS`. ✓
- `SubRole` is defined and exported once (Task 7) and imported by MembersPage; the local duplicate is deleted in the same step. ✓
- `InviteMemberModal`'s prop names (`orgId`, `allowedRoles`, `clients`, `subRoles`, `onClose`, `pinnedRole`, `pinnedClientId`, `initialEmail`, `onSent`) are identical at all three call sites (Tasks 7, 8, 10). ✓
- `offer-email-link`'s body keys (`org_id`, `email`, `participant_name`) are identical in Task 3's handler and both callers (Tasks 5, 6). ✓
- `['linked-drawers']` — the key Task 9 invalidates — is the key `PersonLinkPanel` already uses. ✓
