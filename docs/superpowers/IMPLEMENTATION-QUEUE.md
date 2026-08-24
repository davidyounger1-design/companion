# Companion — implementation queue

Everything designed, found, or half-shipped and not yet done. Written 2026-08-24 at the end of a long
design session, so the next implementation session doesn't have to reconstruct it.

**Ordered by urgency, not by size.** Items 1–3 affect users right now.

Design docs live in `docs/superpowers/specs/`. This file is the worklist, not the design — where a spec
exists, follow it rather than re-deriving.

---

## 1 · URGENT — `'note'` journal entries cannot be saved

**Status:** SQL written (`supabase/migrations/075_log_entries_allow_note_type.sql`), **not applied**.

Reported live 2026-08-24: a support worker picked "Note" from the four entry types, filled it in, and got
"Could not save. Try again." A coordinator reproduced it from the family side ("Could not save entry.").
Coordinator failing is what ruled out roles, permissions and RLS.

Cause: `003_log_entries.sql:10-11` constrains `type` to `('meal','activity','mood','photo')` and no
migration in 74 has widened it — but `'note'` is offered by both entry forms and is in the `LogType` union.
Long-standing, **not** a regression from the sub-role work.

**Do:** apply `075`. Then verify by actually saving a Note entry in the live app, not just by reading the
constraint back.

## 2 · URGENT — every database error shows a generic message

**Status:** diagnosed, not started. A helper (`src/lib/errorMessage.ts`) was drafted and deliberately
reverted to keep this out of the design session.

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

## 3 · Edge functions may still need pasting

`invite-member`, `redeem-invite`, `auto-register` were rewritten 2026-08-23 for sub-roles and all three
also had their non-2xx returns fixed (Supabase swallows the body on non-2xx, which is why `invite-member`
surfaced as an opaque "Edge Function returned a non-2xx status code"). **Unconfirmed whether the corrected
`invite-member` was ever pasted** — the retry result never came back.

**Do:** confirm all three deployed. Until then the live `invite-member` may still reject invites with the
real reason hidden.

---

## 4 · Privacy hardening, Pass A

**Spec:** `specs/2026-08-24-privacy-hardening-design.md`. Target migration `073`. **Fully decided — every
open question closed.** Six items, pure RLS, no schema or frontend changes:

- **A1** drop `"workers can flag notes"` — verified dead code; currently lets any worker rewrite any
  clinical note, including re-parenting it to another participant
- **A2** role-test the `behaviour_notes` SELECT policy
- **A3** three medication policies — every org member can currently read **and write** MAR records
- **A4** role-test `client_ids_for_org()`, closing participant enumeration
- **A5** missing cross-tenant org test on `client_ids_for_family()` (deliberately *not* the therapist helper)
- **A6** participant-scope `notices` and the `messages` group thread; coordinators keep drawer-wide access

Follow the spec's verification section — it includes both halves of each probe (the fix works *and* the
live org's real workflow still works).

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
