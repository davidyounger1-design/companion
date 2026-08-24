# Companion — implementation queue

Everything designed, found, or half-shipped and not yet done. Written 2026-08-24 at the end of a long
design session, so the next implementation session doesn't have to reconstruct it.

**Ordered by urgency, not by size.** Items 1–3 affect users right now.

Design docs live in `docs/superpowers/specs/`. This file is the worklist, not the design — where a spec
exists, follow it rather than re-deriving.

---

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

Same spec, §3. Target `074`. Entitlement gating is browser-only and bypassable by direct API call. Follow
`055`'s precedent (mirror onto `organisations`, sync in `reconcileOrgPlan`, enforce with a restrictive
policy). Must not ship before Pass A.

---

## 6 · Identity & access model

**Spec:** `specs/2026-08-24-identity-access-model-design.md`. Large. All design questions closed.

Cabinet/drawer model: split `clients` into `persons` (identity: name, dob, about, own login) and the
enrolment; staff roles switch plan context, person-side roles get one merged view; active plan travels as a
request header. Includes the identity-linking safeguards and the edit-authority rule (family always;
coordinator only when no family-plan enrolment exists).

**Note the email caveat:** the edit-authority rule can't be enforced by a policy for the login email, which
lives on `auth.users` and is changed via `update-member-email` — a service-role function that bypasses RLS.
The check has to go in the function body or the rule holds for two fields out of three.

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
