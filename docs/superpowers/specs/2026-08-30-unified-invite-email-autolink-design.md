# Unified Invite, Email & Auto-Link — Design

Date: 2026-08-30 · Status: design approved in chat, NOT implemented · Author: Claude Code + David Younger

Builds on `docs/superpowers/specs/2026-08-24-identity-access-model-design.md` (§4.1's
seven linking rules and the 077–082 migrations). Read that first if unfamiliar.

## 1. Purpose

Participant logins and invites are confusing. Four user-facing changes:

1. **One participant concept.** Creating a participant optionally sends a login
   invite; the email address is collected on the participant form itself.
2. **One unified invite form** everywhere, with a plain-language "Who is this
   person?" picker instead of "care recipient" wording.
3. **Email recognition.** When the system recognises an email address that
   already exists elsewhere, it offers the account holder a one-tap link of
   their records across plans.
4. **Hard rule:** linked plans stay separate for providers. Team staff never
   see another plan's journal because of a link. Only the participant and
   their family see the merged view.

## 2. Non-negotiables

- **Provider isolation is absolute.** RLS on `companion.clients`/journal
  tables is org-scoped and does not change in this design. A link merges
  identity (person), never organisation scope.
- **Rule 1 of the linking spec holds everywhere:** no cross-tenant search,
  ever. A coordinator supplies an email and learns nothing back about whether
  it matched.
- **Fail closed** on entitlements, same as today.

## 3. §1 — One participant, two internals (approved)

- One user-facing concept; two internals kept: the `clients` row (enrolment:
  org, setting, decision-maker, active) and the `recipient` role in the
  engine. The word "care recipient" disappears from UI copy.
- New `persons.email` — the match key (§6).
- Wording-cleanup sites found: `src/pages/auth/AcceptInvite.tsx` line 23
  (`ROLE_LABEL.recipient = 'Care Recipient'`) and the `invite-member` edge
  function's own `ROLE_LABEL` (`'care recipient'` in email copy).

## 4. §2–3 — Email on the participant + one unified invite form (approved)

- Add-participant form gains an optional **email** field and a **"Send them a
  login invite now"** checkbox. Email is stored per-enrolment on
  `clients.email`; the auto-create-person trigger carries it to
  `persons.email`.
- Participant manage panel gains an **"Invite to log in"** action.
- One unified invite modal replaces the role-specific invite UIs: name,
  email, phone + a **"Who is this person?"** picker whose options are *The
  participant themselves*, *Family member*, *Support worker*, *Therapist* —
  mapped to recipient / family / support_worker / therapist roles.
- Recipient invites remain gated by the `recipient_login` entitlement
  (server-side backstop in the `invite-member` edge function); client-side
  `FEATURES.recipientLogin` / `FEATURES.therapyCircles` stay as-is.
- The accept page keeps its current shape; a one-tap link card is added
  post-accept (below).

## 5. §4 — Email auto-link (approved)

Person-to-person auto-link reusing the existing machinery (`person_links`,
`person_link_codes`, `confirm_person_link`/`unlink_person` semantics, the
no-chaining guard, reversible unlink). Two trigger points, zero coordinator
UI output:

- **At invite acceptance:** after accepting a recipient invite, if the
  caller's email matches a `persons.email` belonging to a *different* person
  (i.e. an existing record elsewhere), show a one-tap card: "You already have
  a record with {plan name} as {first name} {last initial}. Link them?"
  Confirm → the two persons merge.
- **At coordinator add-participant with email:** fire-and-forget call to a
  new `offer-email-link` edge function. If the email uniquely matches an
  existing person in a different org, the **account holder** (the email
  address itself) gets a confirmation email about the new plan offering to
  link their records. No match, or ambiguous match → no email. The
  coordinator's API response and UI are **byte-identical either way** (rule 1).

**Commit shape** — `public.confirm_email_link(p_target_client_id)` mirrors
`confirm_person_link`, with one additional target-side guard beyond the code
flow (explicitly approved by David):

1. Caller is participant or decision-maker of **a source client** — resolved
   by `persons.email = lower(auth.email())`. Zero rows → `no_matching_email`;
   >1 rows → `ambiguous_email_match` (shared family email; fall back to the
   manual code flow).
2. Target's `clients.email` equals the caller's email (lowercased).
3. **Target's person has no foreign recipient login** — its
   `recipient_profile_id` is null or the caller. (The extra clause vs the
   code flow: the code's possession-of-token check has no email analogue,
   so this is what stops a caller absorbing a drawer whose participant
   login belongs to someone else.)
4. Not self; no chaining (target's person has exactly one clients row).
5. Commit: insert `person_links` (link_method='email', link_code_id null,
   linked_by = auth.uid()); repoint target's `person_id` to the source person.
   **All** drawers of the source person come along — the merge is
   person-to-person, matching the code flow.

- Ambiguous email → the card's UI falls back to the existing manual code
  flow (PersonLinkPanel) instead.
- **Family members never auto-link.** Their merge stays per-enrolment
  `client_family` memberships via `client_ids_for_family()` (080) — a family
  invite-accept produces no card, and a participant link does not extend
  family access to the other plan's drawer.

## 6. Data model & migrations

Next free migration number at writing time: **091** (the tree now contains
083–090; 083 rewrote `accept_invite` — see below). Re-check at implementation
time — the concurrent session is active.

### 6.1 Columns

- `companion.persons.email` — `text`, nullable, **no unique constraint**.
  Shared family emails producing multiple rows is a designed ambiguity case,
  not corruption. Lowercased on write.
- `companion.clients.email` — `text`, nullable, per-enrolment. Lowercased on
  write.
- `companion.person_links.link_method` — `text not null default 'code'
  check (link_method in ('code','email'))`. Existing rows become 'code'
  via the default; email-linked rows have `link_code_id` null (already
  nullable).

### 6.2 Extend 082's trigger (`companion.auto_create_person_for_client`)

- INSERT path (person_id null): carry `email` into the new persons row.
- **New BEFORE UPDATE branch** (fires on accept_invite's client update and
  on coordinator edits): when `new.email` is set and the person's email is
  null, promote it to `persons.email`. First email promoted wins; a later,
  differing email on another enrolment stays enrolment-only and never
  becomes a match key.

### 6.3 `accept_invite` (083 form — it now lives in `companion` schema)

In the recipient branch (083 line ~114), the client update becomes:

```sql
update companion.clients
set recipient_profile_id = v_uid,
    email = coalesce(email, lower(v_invite.email))
where id = v_invite.client_id;
```

The trigger's new UPDATE branch then promotes that email to `persons.email`.
This is what makes the acceptance card possible when the coordinator never
typed an email on the participant form.

### 6.4 `unlink_person` snapshot

The fresh persons row it inserts gains `email` (alongside the existing
full_name/dob/about/recipient_profile_id snapshot) — the two INSERT-into-
persons sites in the whole design both carry email.

### 6.5 New RPCs (081's discipline exactly: public schema, SECURITY DEFINER,
`search_path 'companion','public'`, revoked from public+anon, granted to
authenticated)

- `public.email_link_candidate_for(p_client_id)` — read-only, the card's
  data source. Caller must be participant/decision-maker of that client
  **and** the client must carry the caller's email. If that email uniquely
  matches a different person (not p_client_id's own person), return the
  minimum disclosure (first name,
  last initial, DOB, other plan name); otherwise null. Server-enforced — no
  enumeration possible.
- `public.confirm_email_link(p_target_client_id)` — the commit, as §5.

### 6.6 New edge function: `offer-email-link` (single file, pattern-clone of
`invite-member`)

- Verifies caller JWT + org via userClient (anonKey + user Authorization
  header, db schema 'companion'); caller's org must equal body `org_id`.
- Cross-org match via the admin client: `persons.email = lower(body.email)`
  with a clients row in a **different** org.
- Unique match → send the confirmation email via Resend to
  `body.email`. 0 or >1 matches → send nothing.
- Returns `{ ok: true }` in every case — indistinguishable.
- Resend key stays in Supabase secrets (the reason this is an edge function,
  not a pg_net DB trigger — same as invite-member). No entitlement needed:
  the coordinator acts within their own plan, and participant-side linking
  is free like the code flow.

### 6.7 ⚠ Discovered during write-up — needs David's nod

No existing migration (026, 041, 069, 083 — every `accept_invite` lineage)
syncs `clients.recipient_profile_id` to the **person-level** copy on
UPDATE, and none contains an UPDATE against `companion.persons` at all. 080's
`client_ids_for_recipient()` reads the person-level copy. So a recipient who
accepted an invite after 077 has clients-side set but persons-side null —
and the merged-view helper returns nothing for them. This looks live-broken
today, independent of this design.

Proposed minimal fix, riding on the same UPDATE branch 6.2 already adds:
promote `new.recipient_profile_id` to the person row when the person's is
null (same first-wins semantics). Kept separate so it can be dropped if
you'd rather fix it another way.

## 7. Error & privacy handling

- `confirm_email_link` errors (081's raise pattern): `no_matching_email`
  (defensive — the card shouldn't offer it), `ambiguous_email_match`
  (→ manual code flow), `not_authorised` (email matches a person the caller
  holds no authority over → generic copy + code-flow suggestion),
  `target_email_mismatch` (defensive), `cannot_link_to_self`,
  `target_already_linked` (chaining). UI copy per error; no internals leak.
- The card always discloses the side the confirmer hasn't personally seen:
  at acceptance, their pre-existing record; via the coordinator path, the
  new enrolment. The **email body** discloses only the new plan's name +
  the participant's name — the minimum disclosure happens post-sign-in, in
  the card, server-enforced (rule 4).
- Card dismissal is per-device (localStorage keyed by target client id).
  It may re-appear on another device or a fresh sign-in — harmless, zero
  migration, no server-side dismissal flag.
- Repeat offers: sends on participant creation with an email; an edit that
  changes the email may re-send. Acceptable volume; if it annoys in
  practice, a per-enrolment `email_offer_sent_at` column is the cheap
  hardening. Deferred.
- Audit: every email link lands in `person_links` with
  `linked_by`/`linked_at`/`link_method='email'`; `unlink_person` works
  unchanged (reversible, rule 6), snapshot carries email.

## 8. Testing & verification plan

Migrations follow the 077–082 file template: INSPECT FIRST (read-only) →
migration → POST-MIGRATION VERIFICATION (structural probes runnable from
the SQL editor + behavioural probes documented for a real session).

- **Structural:** columns exist; trigger fires for INSERT-with-email and
  UPDATE-promote (both email and — if 6.7 approved — recipient id);
  grants land exactly as 081's V2; `link_method` constraint.
- **Behavioural** (real accounts, like 081's V3–V7):
  - Two-plan recipient accepts invite → card shows the other plan's minimum
    → confirm → `client_ids_for_recipient()` returns both enrolments;
    **provider isolation probe: each plan's coordinators/workers still see
    only their own org's rows after the link** — the hard rule.
  - Coordinator-add with matching email → responses indistinguishable from
    no-match; account holder receives the email; confirms in-app;
    `person_links` row has `link_method='email'`, `link_code_id` null.
  - Shared/ambiguous email → falls back to the code flow.
  - Chaining refused: email-link onto a target already merged via a code
    link → `target_already_linked`.
  - Foreign recipient login on the target → refused (§5.3).
  - Unlink after email-link → snapshot keeps email, journals re-isolate.
  - Family invite accept → no card; merge stays `client_family` (080
    behaviour unchanged).
  - Accept flow sets `clients.email` from the invite when null (the
    acceptance card's precondition).
- Frontend verification is manual QA in dev plus the live probes above.

## 9. Rollout order & working constraints

Mirrors 077's "additive first, cut over last" discipline:

1. Additive: columns + trigger extension + `accept_invite` email-set —
   zero behaviour change.
2. RPCs + `offer-email-link` edge function — deployed but unwired.
3. UI wiring: card, form fields, unified modal, wording cleanup.

At no point is the app broken mid-sequence.

- All SQL is schema-qualified (`companion.*`) and handed to David to run —
  never auto-applied. Edge functions are single-file paste-into-dashboard
  (no `_shared` imports), deployed manually.
- The design doc and future code work must respect the concurrent-session
  rule: spec lives in the shared tree; implementation happens in a separate
  worktree + feature branch → PR → squash-merge → Actions deploy.
- No secrets in code or chat; Resend key stays in Supabase secrets.

## 10. Out of scope / deferred

- Billing counts untouched — linking does not change who bills what (same
  stance as the 2026-08-24 spec §8).
- `email_offer_sent_at` repeat-send suppression (§7).
- Any change to provider-visible RLS or to the `client_family` merge.
- The 6.7 recipient-id sync, if David prefers to fix it outside this design.
