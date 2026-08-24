# Companion — implementation queue

Everything designed, found, or half-shipped and not yet done. Written 2026-08-24 at the end of a long
design session, so the next implementation session doesn't have to reconstruct it.

**Ordered by urgency, not by size.** Items 1–3 affect users right now.

Design docs live in `docs/superpowers/specs/`. This file is the worklist, not the design — where a spec
exists, follow it rather than re-deriving.

---

## 0 · IN PROGRESS (2026-08-24) — MAB webhook was never registered, and would have 401'd anyway

Found while investigating why a cancelled test org's `billing_status` stayed stale: `sync-subscription`
had no `config.toml` entry, so it sat on the platform default `verify_jwt=true` since deploy — every
delivery attempt would 401 at the gateway before the function's own HMAC check ever ran (confirmed by
cross-checking MAB's `api/lib/events.php`, which sends only `Content-Type`/`X-MAB-Signature`, no
`Authorization` header). Separately, and independently fatal on its own: MAB's `webhook_endpoints` table
has zero rows for Companion — only Haven's and Leave Planner's exist. Billing-status sync has relied
entirely on the pull-based `check-plan` call at sign-in this whole time.

**Done:** `verify_jwt` fixed (redeployed with `--no-verify-jwt`, confirmed live). A coordinator-only
"Register webhook" button added to the Subscription page (`0.5.127`) — calls the existing but never-wired
`register-mab-webhook` function and displays its response.

**Do:** as coordinator, open Account → Subscription, click "Register webhook". It returns a `whsec_...`
secret and next steps. Set that as this project's `MAB_WEBHOOK_SECRET` (Supabase secret, via CLI or
Dashboard — not in chat), then in MAB Admin → Developers → Webhooks, find the new Companion endpoint and
click Activate (it registers inactive/fail-closed). Once activated, remove the button from `Account.tsx`.

## 1 · DONE (2026-08-24) — `'note'` journal entries cannot be saved

**Status:** `075` applied live and confirmed working — a Note entry saves correctly now.

Reported live 2026-08-24: a support worker picked "Note" from the four entry types, filled it in, and got
"Could not save. Try again." A coordinator reproduced it from the family side ("Could not save entry.").
Coordinator failing is what ruled out roles, permissions and RLS.

Cause: `003_log_entries.sql:10-11` constrains `type` to `('meal','activity','mood','photo')` and no
migration in 74 has widened it — but `'note'` is offered by both entry forms and is in the `LogType` union.
Long-standing, **not** a regression from the sub-role work.

**Do:** apply `075`. Then verify by actually saving a Note entry in the live app, not just by reading the
constraint back.

## 2 · DONE (2026-08-24) — every database error shows a generic message

**Status:** `src/lib/errorMessage.ts` added and wired in at 13 real sites; deployed as `0.5.125`. Six
sites that looked identical (auth/setup flows backed by `lib/auth.ts`) were already correct and left
untouched, since those helpers already wrap Supabase errors in a real `Error` upstream.

Supabase rejects with a `PostgrestError` — a plain object, **not** an `Error` instance. So the
`e instanceof Error ? e.message : 'Could not save…'` pattern throws away the real reason for every
database failure. Item 1 above was invisible for months because of this: the constraint violation message
said exactly what was wrong and the UI discarded it.

**Do:** add an `errorMessage(e, fallback)` helper that handles `Error`, `PostgrestError`
(`message`/`details`/`hint`) and strings, then replace the `instanceof Error` pattern at all ~10 sites.
Known sites: `AddEntry.tsx:156`, `FamilyDashboard.tsx:414`, `WorkerClientDetail.tsx` (addLog),
`CoordinatorClientDetail.tsx:449` and `:506`, `BehaviourNoteForm.tsx:140`, `GoalForm.tsx:86`,
`IncidentForm.tsx:104`, `MedicationForm.tsx:121`, `MedicationLog.tsx:93`, `ProgressRecordForm.tsx:67`.

This is cheap and it pays for itself the next time something like item 1 happens.

## 3 · DONE (2026-08-24) — `redeem-invite` and `auto-register` were running stale code

**Status:** confirmed via direct `supabase functions download` + diff against committed source, then
redeployed via `supabase functions deploy --use-api` and re-verified byte-identical. Live now.

`invite-member`, `redeem-invite`, `auto-register` were rewritten 2026-08-23 for sub-roles and all three
also had their non-2xx returns fixed (Supabase swallows the body on non-2xx). `invite-member` had in fact
been redeployed (confirmed identical to committed source). **`redeem-invite` and `auto-register` had not**
— both were still running code from mid-July, predating both fixes. This was a real live bug, not just an
unconfirmed deploy: `redeem-invite` never set `sub_role_id` on the new profile, so every invite redemption
silently dropped the coordinator's chosen sub-role and fell back to the org's default — directly
undercutting the sub-role permission system shipped earlier in this session.

---

## 4 · DONE (2026-08-24) — Privacy hardening, Pass A

**Status:** `073` run live 2026-08-24. Structural checks V1/V2/V3 confirmed via direct read-only query
afterward — dead UPDATE policy gone, only the 9 already-coordinator-gated callers of
`client_ids_for_org()` remain (down from 14), both rewritten functions are `SECURITY DEFINER` with the
correct `search_path`. Behavioural checks V4–V10 (need real per-role JWTs) not yet run — do those if a
live-traffic proof is wanted, but the structural evidence already confirms the migration applied as
written with no drift.

**Spec:** `specs/2026-08-24-privacy-hardening-design.md`. Migration `073`, committed `98b8d85`. Seven
items, pure RLS, no schema or frontend changes:

- **A1** drop `"workers can flag notes"` — verified dead code; currently lets any worker rewrite any
  clinical note, including re-parenting it to another participant
- **A2** role-test the `behaviour_notes` SELECT policy
- **A3** three medication policies — every org member can currently read **and write** MAR records
- **A4** role-test `client_ids_for_org()`, closing participant enumeration
- **A4b** (found live, not in the original spec) three more `client_ids_for_org()` callers that A4 would
  otherwise silently break: `"family can manage client_workers"`, `"family can manage client_family"` —
  rescoped to `client_ids_for_family()` — and `"can view photos for visible entries"`, given a real
  worker clause it never had
- **A5** missing cross-tenant org test on `client_ids_for_family()` (deliberately *not* the therapist helper)
- **A6** participant-scope `notices` and the `messages` group thread; coordinators keep drawer-wide access.
  **Rewritten 2026-08-24** after direct DB inspection found the live policies (`"view notices"`,
  `"view messages"`) don't match any migration file — the original draft here would have been a no-op

Verified via direct read-only queries (I1–I4 in the file, plus one extra live I3 re-run after A4b): every
one of the 14 total live callers of `client_ids_for_org()` is now either already coordinator-gated inline
(8, unaffected by A4), fixed by A3 (3), or fixed by A4b (3) — none left ungated.

Optional follow-up: run V4–V10 (behavioural, need real per-role JWTs) for live-traffic proof — not
required, the structural checks already confirm a clean apply.

## 5 · Privacy hardening, Pass B — server-side entitlements

Same spec, §3. Entitlement gating is browser-only and bypassable by direct API call. Follows `055`'s
precedent (mirror onto `organisations`, sync in `reconcileOrgPlan`, enforce with a restrictive policy).
Must not ship before Pass A — which is now done (item 4).

**Split into two steps after discovering there are FOUR active orgs today, not the one the spec's risk
analysis assumed** — including two duplicate "The Friendship Circle" rows sharing one subscription id, and
one whose `plan` column holds what looks like a display name ("Family +") rather than a real MAB slug.
None of the four have ever had entitlements resolved server-side, and `behaviour_notes` /
`medication_tracking` / `incident_workflows` aren't gated by `RequireFeature` anywhere in the frontend today
— so there's no existing signal whether any of their MAB plans actually have those keys ticked on. Shipping
the restrictive gate on that assumption risks locking a real org out of a table it's using right now.

- **Step 1 — DONE (2026-08-24).** `074_org_entitlements_mirror.sql`: adds `organisations.entitlements
  jsonb`, `public.org_has_feature(text)` (fail-closed, `stable security definer`), and
  `reconcileOrgPlan`/`fetchFeatures` now write the org's resolved feature set on login. Purely additive —
  nothing reads or enforces it yet, so this changes no live behaviour. Frontend shipped as `0.5.126`.
- **Step 2 — blocked on data, not code.** Once each of the four orgs has logged in at least once
  post-`074`, run the verification query at the bottom of that file. Any table a org is actively using but
  whose feature key is missing from its mirrored `entitlements` is a MAB Admin gap (tick the key onto that
  plan) that must be fixed before the gate can go in for that org. Only once all four check out clean should
  the actual restrictive `for all` gate on `behaviour_notes`/`medications`/`medication_logs`/
  `participant_goals`/`incidents` ship, as a follow-up migration.

---

## 6 · Identity & access model — IN PROGRESS (started 2026-08-25)

**Spec:** `specs/2026-08-24-identity-access-model-design.md`. Large, 7-stage rollout per §5, additive-first.

Cabinet/drawer model: split `clients` into `persons` (identity: name, dob, about, own login) and the
enrolment; staff roles switch plan context, person-side roles get one merged view; active plan travels as a
request header. Includes the identity-linking safeguards and the edit-authority rule (family always;
coordinator only when no family-plan enrolment exists).

**Note the email caveat:** the edit-authority rule can't be enforced by a policy for the login email, which
lives on `auth.users` and is changed via `update-member-email` — a service-role function that bypasses RLS.
The check has to go in the function body or the rule holds for two fields out of three.

Progress against §5's 7 steps:
- **Step 1 + 1a — DONE.** `077_persons_identity_split.sql` run live, all four verification checks (V1–V4)
  confirmed via direct query: `companion.persons` created and backfilled 1:1 from every existing `clients`
  row (a per-row loop, not a `row_number()` pairing — two live rows share every backfilled column, which
  would have made a naive pairing genuinely risky), the `companion.participants` `security_invoker` view
  added. Zero behaviour change — nothing reads either yet.
- **Step 1b — not started.** Drop `clients.full_name`/`dob`/`about`/`recipient_profile_id`/`goals` once
  every frontend/function reader is repointed at the `participants` view. Requires a grep-everything pass
  first; deliberately the hardest and most irreversible step, done last among 1/1a/1b.
- **Step 2 — DONE.** `078_profile_orgs.sql` run live, V1–V3 confirmed via direct query: 13 `profile_orgs`
  rows backfilled 1:1 from the 13 profiles with a non-null `org_id`, zero role/sub_role_id mismatches, RLS
  enabled with only `SELECT` granted, composite FK validated. `profiles.org_id`/`role`/`sub_role_id` stay
  untouched as the "primary plan" until step 7.
- **Step 3 (active-context plumbing) — next.**
- Steps 4–7 (frontend plan switcher, person-scoping the two read helpers, linking itself, cleanup) — not
  started.

Trigger for this work: David tried to add Sarah Younger (already a participant on her family plan) as The
Friendship Circle's first participant — the exact cross-plan scenario this spec exists for, and the
schema/linking work wasn't done yet. Chose to build it properly rather than add her as a disconnected
duplicate.

---

## 7 · Programs — needs re-slicing before implementation

**Spec:** `specs/2026-08-24-programs-design.md`. **Do not implement as written.** Three adversarial reviews
found ~14 defects including three critical, all corrected in the doc, but they also showed the feature is
larger than the agreed "foundation + primary surfaces" slice. Re-slice with David first.

Carries one agreed sub-task: rewrite the ~12 inlined `client_workers` predicates in `incidents`,
`ndis_records`, `participant_goals`, `goal_progress_records` and `active_timers` to call
`client_ids_for_worker()`. That is both what makes program-derived access reach those tables **and** what
retroactively gives them `069`'s cross-tenant org test, which they never received.

## 8 · `071` / `072` — written, unrun

- **`071`** retires `trusted_support_worker`. Gated on a human attestation that the served frontend no
  longer offers the role — confirm the live app, then insert the gate row.
- **`072`** bridges `add_entries` to a restrictive RLS policy. The frontend disabled state already shipped
  in 0.5.123, so the ordering requirement is satisfied.

Both are independent of `075` and of Pass A; any order is safe.

---

## Open questions — not blocking, but not decided

- **Per-seat vs per-participant metering within a single plan.** The contradiction in
  `Companion-Gap-Report.md` between MAB's pricing card and the integration doc. Gates any billing work.
  (Settled separately: *cross-plan* membership is irrelevant to billing — see the identity spec §8.)
- **The `programs` MAB entitlement key doesn't exist yet.** Needs adding in MAB Admin, on for
  Solo/Starter/Team/Enterprise, off for Family and Family +. A newly published key starts included in **no**
  plan, so it must be ticked onto plans or the feature stays invisible everywhere.
- **Two organisations are both named `The Friendship Circle`** (`87f8899c…`, 0 people; `a853f423…`, 1
  person). Duplicate names will make multi-plan testing very confusing. Worth resolving first.
- **`Companion-Gap-Report.md` is substantially out of date** — roughly half its "missing" items already
  ship (incidents, medication tracking, goals, recipient login, entitlement gating, retention). Verified
  item by item 2026-08-24. Don't plan from it without checking the repo.
