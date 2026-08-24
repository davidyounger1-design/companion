# Companion — Programs: re-slice proposal (decision)

Status: for David's decision. Source of truth: `2026-08-24-programs-design.md` (approved 2026-08-24).
This document re-slices implementation per `IMPLEMENTATION-QUEUE.md` §7 ("Do not implement as
written ... Re-slice with David first"). It does not re-derive the design; it maps it, explains why
it is bigger than the agreed slice, proposes a concrete cut, and asks for a decision.

## 1. What the full design covers (map of the spec)

- §1 Why/now: provider-tier feature; from-scratch build (no `programs` tables exist anywhere in
  migrations or src); the only live org is on the Family plan, so no data migration, no backfill,
  no half-shipped-state risk for a real customer.
- §2 Decisions locked (do not re-derive): Programs ships before Rostering; gating is a `programs`
  MAB entitlement key, not an `org_type` check; families and therapists link to the participant,
  never to a program; the `program_id` picker rule (candidates = the participant's active programs,
  narrowed by the author's programs only when the author is a support worker; silent save when
  unambiguous); v1 scope = "Foundation + primary surfaces".
- §3 Data model: `programs`, `program_participants`, `program_workers`; composite FKs
  `(id, org_id)` make cross-org assignment structurally unexpressable; `clients(id, org_id)` unique
  added as a prerequisite; `role_in_program` dropped (YAGNI); `profiles` asymmetry noted as
  residual risk.
- §4 Access control: one function change — `client_ids_for_worker()` gains a program-derived
  `union`, both branches org-tested; every worker-scoped policy inherits it; no-op on deploy until
  membership rows exist; family/recipient/therapist paths untouched.
- §5 `program_id` on records: nullable on `log_entries`, `behaviour_notes`, `incidents` (incidents
  added beyond the original spec, so the dashboard filter can filter the incidents card
  consistently). `shifts.program_id` deferred to Rostering's cycle.
- §6 UI surfaces (v1): program management route; dashboard program filter; participant roster
  program tags; the `program_id` picker; entitlement plumbing.
- §7 Migrations: infra file + RPCs file (incl. a `remove_member` program-cleanup fix); rollout
  order infra → verify → RPCs → frontend.
- §8 Verification: structural (RLS/grants/definer discipline), behavioural (family/therapist
  invariant byte-identical before/after; cross-program RLS probes), performance (helper still
  resolves as an InitPlan).
- §9 Out of scope: rostering; the NDIS compliance cycle; the two other missing entitlement keys;
  commercial tiers; the billing-metering question; the same-participant-two-orgs scenario.
  **Status corrections since approval:** the compliance cycle has largely landed in this repo
  (`record_revisions` 084, `restrictive_practices` 086, `behaviour_support_plans` 087, server-side
  exports + `export_log` 088 — landed across Tasks 1–5 of this workflow), and the `ndis_records` entitlement key now exists
  (cf00415, declared, pending MAB Admin plan assignment). Only `rostering` remains as a missing key.
- §10 Residual risks: function-body drift vs migration files; `profiles` lacks `(id, org_id)`
  unique; no provider-tier org to test against; three defects found and corrected by review.

## 2. Why it is larger than the agreed slice

Queue §7's finding: three adversarial reviews found ~14 defects including three critical, all
corrected in the doc, but they also showed the corrected feature is bigger than the agreed v1
slice. The load-bearing ones, one line each (the three criticals are the spec's own §10.4 list):

- **Critical — the §4 union body omitted `= public.my_org_id()` in both branches in its first
  draft**; pasted as written it would have silently reverted 069's cross-tenant fix across every
  worker-scoped policy.
- **Critical — `clients(id, org_id)` unique was missing**; without it the `program_participants`
  composite FK is structurally impossible, and the constraint must precede the FK in the same file.
- **Critical — `remove_member` knows nothing about programs**; without added cleanup a removed
  member retains program-derived access to their old org — the exact hole 069 was written to close,
  reopened through the new path.
- §10.1 — `client_ids_for_worker()`'s live body may not match the migration-file text (060's sweep
  rewrote bodies in place); the risk already materialised once, in this very spec. Pre-paste
  `pg_get_functiondef` reconciliation is now a required step, not a nicety.
- §10.2 — `profiles` has no `(id, org_id)` unique, so `program_workers`' org integrity rests on RPC
  discipline; a service-role insert could disagree with `profiles.org_id` (integrity wart, not an
  access hole — the union's org test denies access).
- §5 — `incidents.program_id` added beyond the original spec (the dashboard filter must move every
  panel, including the incidents card, consistently).
- §6.2 — the dashboard filter threads `programId` through all six `useQuery` keys in
  `CoordinatorDashboard.tsx`, not one.
- §10.3 — no live provider-tier org exists; every §8 verification query runs against fresh test
  data.
- The 11-predicate consolidation is required scope: without it, program-derived access never
  reaches `incidents` / `participant_goals` / `goal_progress_records` / `active_timers` (their
  policies inline `client_workers` joins that bypass the helper).

Net: the agreed slice already contains a DB core (two tables sets, one constraint, one helper
rewrite, two migrations, one fix to a live function, one consolidation) **plus** five UI surfaces.
That is two shippable units, not one — hence this re-slice.

## 3. Proposed re-slice: "Foundation + primary surfaces"

### 3.1 Foundation slice — the non-negotiable core (DB only)

In:

- `programs`, `program_participants`, `program_workers` tables with composite org FKs (§3).
- `clients(id, org_id)` unique constraint (§3 prerequisite).
- RLS on the three new tables (coordinator-only write, org-scoped read) — the discipline 060
  established (bare `create table` is world-writable by default without it).
- `client_ids_for_worker()` union rewrite (§4) — the single access-control change; no-op on deploy.
- Nullable `program_id` on `log_entries`, `behaviour_notes`, `incidents` (§5).
- The seven CRUD/assignment RPCs plus the `remove_member` program-cleanup fix (§7 "074" half) —
  deliberately included: the RPCs are the sanctioned, org-checked write path for the data model
  (without them the schema is only reachable via the SQL editor), and the `remove_member` fix is
  part of access control, not sugar.
- The 11-predicate consolidation (089) — ships regardless of the chosen slice (see §7).

Out of the foundation: every UI surface and the entitlement-key declaration.

### 3.2 Primary surfaces (spec §6 v1 — frontend only)

In:

1. `/programs` management route, coordinator-only, `RequireFeature('programs')`, with
   participant/worker assignment panels reusing `ClientManagePanel`'s picker interaction.
2. Dashboard program filter — `programId` state threaded through all six query keys and their
   `where`/`.eq()` predicates, including the incidents card.
3. Participant roster program tags — colour-coded chips, one per active program.
4. `program_id` picker on the worker log form, coordinator log form, and behaviour-note form
   (silent when unambiguous; zero-friction quick-log preserved).
5. Entitlement plumbing — `programs` in `mab-features.json` + `src/lib/features.ts`; the route,
   filter, and tags render conditionally on `has(FEATURES.programs)`.

No migrations in this slice.

### 3.3 Explicitly OUT of the first slice (named, with one-line reasons)

From spec §2 point 6 (all four asserted additive on this schema; none require touching it again):

- **NDIS export program-scoping** — the exports subsystem now exists (088, Task 5), but giving
  exports a program dimension is a separate additive feature; no provider org exists to need it.
- **Per-program billing breakdown** — blocked on the unresolved billing-metering question (per-seat
  vs `active_clients`); that question must be resolved with David before any billing-counting code,
  anywhere.
- **Needs-review-queue filtering** — additive UI later; no schema change.
- **Onboarding step 3 (program creation during signup)** — additive onboarding step; Family-plan
  signups unaffected (provider-tier feature).

From spec §9 (separate cycles, not blocking):

- **Rostering** (`shifts`, `shift_participants`, `shift_handovers`) — separate design cycle;
  structurally depends on Programs (every shift is per-program). `shifts.program_id` is already
  answered by this design, not reopened.
- **NDIS reporting/compliance remainder** — mostly landed since approval (084/086/087/088); what
  remains is the export program-scoping deferral above.
- **The `rostering` entitlement key** — still missing; added when Rostering is built.
- **Family +/Enterprise tiers, six-tier pricing card** — unrelated to Programs' technical design.
- **Billing-metering open question** — not needed by any slice here; resolves before any billing
  code in a future cycle.
- **Same participant in two organisations (§9.1)** — own design cycle; Programs is org-internal and
  remains correct either way. Hygiene prerequisite: the two orgs both named "The Friendship Circle"
  (`87f8899c…`, `a853f423…`) should be resolved before Programs is exercised against that scenario.

### 3.4 Migration split (each slice self-contained and applyable)

- **Foundation:** `089` (ready, untracked — a controller commit ships it in this task's merge
  cycle) + `090_programs_infrastructure` + `091_programs_rpcs`. Numbering: the spec's 073/074 are
  taken (`073_privacy_hardening_rls`, `074_org_entitlements_mirror`; the repo now runs to 089); the
  spec's logical split — infra, then RPCs — carries over unchanged. Applied as one set the
  foundation is complete and verifiable (§8 items 1-8 are DB-level).
- **Primary surfaces:** frontend only; no migrations.
- **Option C (full design)** would additionally include: export program-scoping, needs-review
  filtering, onboarding step 3, per-program billing (once metering is decided).

## 4. What the slice enables vs what it defers

**Foundation alone (Option A)** enables: the live cross-tenant read gap closed on 11 policies
(089, today); program-derived access org-tested end-to-end once memberships exist; structural org
integrity via composite FKs; the `remove_member` hole closed; `program_id` in place so every later
surface (dashboard filter, exports, billing, compliance) inherits it without touching the schema.
Defers: everything a user can see or do — no UI. Compliance impact: none negative; rework risk:
zero by design (the UI builds directly on the foundation); customer-facing gap: zero today (no
provider-tier org live). Cost: the DB layer ships and sits unused until the UI slice lands.

**Foundation + primary surfaces (Option B — the spec's own v1 scope)** enables the complete agreed
feature: coordinators create programs, assign participants/workers, filter the dashboard, tag the
roster, attribute logs/notes. Defers: the named items in §3.3. Compliance impact: neutral-positive
— the compliance tables that landed across Tasks 1–5 of this workflow inherit `program_id` readiness. Rework risk: low
— every deferred item is asserted additive.

**Deferral costs, item by item:**

- NDIS export program-scoping — deferred: an export cannot yet be sliced by program. Impact: none
  until a provider org asks; the export code simply doesn't read `program_id` yet. Rework: low.
- Per-program billing — deferred: no per-program revenue reporting. Impact: none while the metering
  question is open; resolving it later does not revisit this schema. Rework: low.
- Needs-review filtering — deferred: the review queue stays program-agnostic. Impact: UI
  convenience only. Rework: low.
- Onboarding step 3 — deferred: signups don't create programs yet. Impact: none (provider-tier).
  Rework: low.
- Rostering — deferred to its own cycle: no shifts until then. Impact: planned; this design already
  answers its access-control question. Rework: none.
- Same-participant-two-orgs — deferred: own cycle. Impact: none on Programs. Rework: none.

## 5. Open questions for David (bracketed default — no reply means accept)

1. Which slice — A, B or C (see §6)? [B]
2. Renumber the spec's 073/074 to 090/091 for the foundation, keeping the split? [Yes]
3. When to declare the `programs` MAB entitlement key (mab-features.json + features.ts) and tick
   it onto Solo/Starter/Team/Enterprise in MAB Admin? The DB layer is not gated; the key gates only
   UI. [With the UI slice]
4. Resolve the duplicate "The Friendship Circle" orgs before any provider-tier exercise of
   Programs? [Yes]
5. 089 rides in this task's merge cycle regardless of the chosen slice? [Yes]
6. Verify against freshly-created test orgs with direct-API probes (this morning's pattern), since
   no provider-tier org exists? [Yes]

## 6. Decision — three options

**Option A — Foundation only.** Ship 089 + 090 + 091 and stop there. Smallest verifiable unit;
both security fixes (cross-tenant consolidation, `remove_member`) land now; nothing is
customer-visible. Cost: a completed, verified DB layer with no UI until a second cycle — the
feature stays invisible, and the UI build still has to happen for any user value.

**Option B — Foundation + primary surfaces (recommended).** This is exactly the spec's approved v1
scope (§2 point 6), split into two verifiable halves with the rollout order the spec itself set
(foundation → verify → UI). One coherent delivery: schema + access control + the five UI surfaces,
gated behind the `programs` key. Cost: the full v1 build — one coordinator route, the dashboard
filter, roster tags, a picker, entitlement plumbing — which is the size that prompted the re-slice
question, but no deferred item's cost is incurred and no spec decision is reopened.

**Option C — Full design.** Foundation + primary surfaces + every deferred item (export
program-scoping, needs-review filtering, onboarding step 3, per-program billing, rostering). Cost:
contradicts the spec's own locked decisions (§2.1 Programs-before-Rostering; §2.6 deferrals) and
stalls on the unresolved billing-metering question. Benefit: none today — no provider org exists
to use any of it.

**Reply with the option letter (A / B / C) plus any amendments.** §5 questions left unanswered are
taken as their bracketed defaults.

## 7. Prep status: the 11-predicate consolidation (089)

Ready now (untracked; a controller commit ships it in this task's merge cycle) and ships under any
slice — it is what makes program-derived access reach those tables, and it retroactively fixes the
cross-tenant gap they never received. Verified facts (not the queue's wording): exactly **11** live
inline worker-membership predicates are rewritten to `(select public.client_ids_for_worker())` —
`incidents` (053 ×2), `participant_goals` (058 ×4), `goal_progress_records` (058 ×2),
`active_timers` (066 ×3). 054's three inline predicates sit on the goal tables and were dropped by
058 — dead, not rewritten. There is **no** `ndis_records` table or RLS policy anywhere in the
migrations — nothing to rewrite there; the queue's "~12 incl. ndis_records" wording is stale. All
non-worker clauses, grant scopes, and policy names are preserved verbatim; `trusted_support_worker`
role branches are left for 071's retirement, untouched.
