# Companion — Programs (design spec)

Status: approved by David 2026-08-24, pending final read-through before implementation planning.
Scope: **Programs only.** Rostering (`Companion-Team-Mode-Spec.md` §3) is a separate, later design cycle —
it structurally depends on Programs (every shift is per-program) and is deliberately excluded here.
NDIS compliance (`record_revisions`, `restrictive_practices`, `behaviour_support_plans`, a real `exports`
subsystem) is a separate, later cycle too — see "Sequencing" below for why it comes after, not before.

Source documents: `C:\Temp\Companion-Team-Mode-Spec.md` §2 (behavioural spec) and
`C:\Temp\Companion-Gap-Report.md` §2a, §5, §6 (what's actually missing, verified against the live repo).
Where they disagree, this spec states which one wins and why.

---

## 1. Why Programs, and why now

A provider (Solo/Starter/Team/Enterprise tier) runs multiple **programs** — day program, group home,
in-home, community access — each with its own participants and its own team of workers. A participant may
attend one or several; a worker may staff one or several. Today Companion has no such concept: a worker's
access to a participant is a single flat `client_workers` join, with no way to express "this worker only
sees participants in the day program they staff."

**Verified against the live repo (2026-08-24), not assumed:** `programs`, `program_participants`,
`program_workers` do not exist anywhere in `supabase/migrations/` or `src/`. This is a from-scratch build,
not an extension of a partial one.

**Scale reality:** the one real live org (Sarah Younger's Care Circle) is on the free Family plan.
Programs is a provider-tier feature — no current user is affected by this migration, so there is no data
migration, no backfill, and no half-shipped-state risk for a real customer. This materially lowers the
risk of getting the rollout order wrong compared to this morning's sub-role work.

---

## 2. Decisions already made (do not re-derive)

1. **Programs ships before Rostering**, as its own complete, verified feature — not a shared migration.
2. **Sequencing vs. the gap report's stated priority order:** the gap report lists NDIS compliance
   (Priority 1) ahead of Programs (Priority 2). This spec does Programs first anyway. Rationale, confirmed
   with David: Programs is the item that "touches the data model everywhere" — the compliance tables
   (incident register, restrictive-practices register, exports) all want program attribution on day one,
   so building compliance first means retrofitting `program_id` into brand-new tables immediately
   afterwards. Building Programs first means the compliance cycle inherits `program_id` for free.
3. **Gating: a `programs` MAB entitlement key**, not an `org_type` check.
   **This is a direct contradiction between the two source documents**, resolved in favour of the gap
   report: Team-Mode-Spec §0/§2 says "Programs (§2) are core structure, not gated — available to every
   provider tier." The gap report §2a and its Priority 5 table say add a `programs` key, on for
   Solo/Starter/Team/Enterprise, off for Family/Family +. The gap report is more specific (names the exact
   MAB config action, ships a full gating table cross-checked against live entitlement code) and is the
   newer of the two documents by internal evidence (it's written *about* the team-mode spec, references it
   by section, and corrects it in several other places — e.g. the family-links-to-participant rule below).
   Followed here. **Requires a MAB-side action, not code:** add the `programs` key to the entitlement
   matrix, on for Solo/Starter/Team/Enterprise, off for Family/Family +.
4. **Family- and therapist-access invariant (from the gap report, absent from the team-mode spec):**
   families and therapists link to the **participant**, never to a program. There is no family↔program or
   therapist↔program relationship, and none should be created. Adding or removing a participant from a
   program must **never** change family or therapist access, and a family member's daily digest is **one
   combined digest across every program the participant attends**, never split per-program. The
   decision-maker is a property of the participant, not of any program.
5. **`program_id` picker rule** (refined from the original spec, which only defined it for a worker
   author): candidates = the participant's active programs, narrowed by the author's own programs **only
   when the author is a support worker**. Exactly one candidate → set silently. More than one → a small
   picker on the log/note form. Zero → leave null. This covers all four authoring roles (coordinator,
   family, support worker, recipient) with one rule — a coordinator or family member has no programs of
   their own, so the narrowing step is simply skipped for them, and they get the participant's programs
   directly.
6. **v1 surface scope** (the "Foundation + primary surfaces" slice): program CRUD, participant/worker
   assignment, the `client_ids_for_worker()` access union, `program_id` on entries/notes with the picker,
   the coordinator dashboard program filter, and program tags on the participant roster.
   **Deferred to a later cycle:** NDIS export program-scoping (blocked on the exports subsystem not
   existing at all yet — see §1), the per-program billing breakdown, needs-review-queue filtering, and
   onboarding step 3 (program creation during signup). All four are additive on top of this spec's schema;
   none require touching it again.

---

## 3. Data model

```sql
programs (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organisations(id) on delete cascade,
  name        text not null,
  kind        text not null check (kind in ('day_program','group_home','in_home','community_access','other')),
  colour      text,               -- hex, for the UI's colour-coded chips/tags
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint programs_id_org_uk unique (id, org_id)   -- makes the composite FKs below possible
)

program_participants (
  program_id     uuid not null,
  participant_id uuid not null,
  org_id         uuid not null,
  joined_at      timestamptz not null default now(),
  left_at        timestamptz,      -- soft-delete: leaving one program must not affect others (§2.3)
  primary key (program_id, participant_id),
  foreign key (program_id, org_id)     references programs(id, org_id)  on delete cascade,
  foreign key (participant_id, org_id) references clients(id, org_id)   on delete cascade
)

program_workers (
  program_id  uuid not null,
  worker_id   uuid not null,
  org_id      uuid not null,
  assigned_at timestamptz not null default now(),
  removed_at  timestamptz,
  primary key (program_id, worker_id),
  foreign key (program_id, org_id) references programs(id, org_id) on delete cascade
  -- worker_id -> profiles(id) is a plain FK (profiles has no (id, org_id) unique key yet;
  -- org match is enforced in the assignment RPC instead, same pattern as sub_roles' RPCs today)
)
```

Three deliberate deviations from the team-mode spec's original sketch:

- **`org_id` on both join tables**, with composite FKs `(program_id, org_id) → programs(id, org_id)` and
  `(participant_id, org_id) → clients(id, org_id)`. This makes assigning org A's participant into org B's
  program **structurally unexpressable** — not via the app, not via a service-role edge function, not via
  the SQL editor — rather than relying on every RPC to remember to check it. Same mechanism used for
  `sub_roles` in this morning's `068` migration; not a new pattern for this codebase.
- **`role_in_program` (worker/lead) dropped.** Specced but never read anywhere in either source document's
  behavioural description — §2/§3 always select "workers assigned to that program" with no lead
  distinction. YAGNI; a one-column, backwards-compatible addition whenever a real behaviour needs it.
- **`clients` needs a new `unique (id, org_id)` constraint** to make `program_participants`' composite FK
  possible. Additive, no behaviour change. **Verified 2026-08-24:** `clients` (defined in
  `002_clients_workers.sql:5`) has *only* `id uuid primary key` — there is no existing `(id, org_id)`
  unique constraint to reuse, so `073` must add one, and it must come *before* the
  `program_participants` FK in the same file or the FK creation errors.
- **`profiles` likewise has no `(id, org_id)` unique key**, which is why `program_workers.worker_id` is a
  plain FK to `profiles(id)` and its org match is enforced in the assignment RPC rather than declaratively.
  This is a deliberate asymmetry with `program_participants`, and a weaker guarantee — noted as residual
  risk §10.4.

---

## 4. Access control

**One function change, not a policy sweep.** `public.client_ids_for_worker()` is the sole chokepoint for
worker→participant access — 14 policy references across 8 tables (`clients`, `log_entries`,
`behaviour_notes`, `client_feedback`, `schedule_items`, `active_timers`, and more). Add a `union` over
program-derived access and every one of those 14 policies inherits it automatically:

```sql
create or replace function public.client_ids_for_worker()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  -- Direct assignment. The clients join + org test is NOT decoration: it is
  -- the cross-tenant fix shipped in 069 (a removed worker whose profile was
  -- detached retained read access to their old org's participants AND
  -- behaviour notes, because client_workers rows survive detachment).
  -- Removing it silently reintroduces that hole across all 14 policies.
  select cw.client_id
  from   companion.client_workers cw
  join   companion.clients c on c.id = cw.client_id
  where  cw.worker_id = auth.uid()
    and  c.org_id = public.my_org_id()
  union
  -- Program-derived. Same org test, for the same reason: program_workers rows
  -- also survive profile detachment, and my_org_id() is NULL for a detached
  -- profile, so this correctly denies rather than leaking.
  select pp.participant_id
  from   companion.program_workers pw
  join   companion.program_participants pp on pp.program_id = pw.program_id
  where  pw.worker_id = auth.uid()
    and  pw.removed_at is null
    and  pp.left_at  is null
    and  pw.org_id = public.my_org_id()
$$;
```

⚠ **This body was wrong in the first draft of this spec** — both branches omitted
`= public.my_org_id()`, which would have reverted `069`'s cross-tenant fix the moment it was pasted.
Recorded here because the failure mode is instructive: the union was written from the *migration file's*
historical shape rather than from the live function, which is exactly the trap `060`'s in-place sweep sets.
**Reconcile against `pg_get_functiondef` before pasting, every time** — do not trust this document or the
migration files.

Rejected alternatives, and why:
- **A separate program-access helper OR'd into each of the 14 policies** — gives per-table opt-out that
  neither source document wants (team-mode spec §2.1: "Both paths grant the same access"), at the cost of
  14 hand-pasted policy edits in a repo with no CI. Higher risk, no behavioural benefit.
- **Denormalizing program membership into `client_workers` via trigger** — fastest reads, but destroys the
  distinction between direct and program-derived assignment, making §2.3's "removing from one program
  doesn't remove them from the org" unimplementable, and invites drift between the trigger and the source
  tables.

**This is a no-op on deploy.** The `union` returns nothing until `program_workers`/`program_participants`
have rows, so every existing org's resolved access is bit-identical before and after `073` runs.

**Performance:** all 14 existing call sites already use `client_id in (select public.client_ids_for_worker())`,
which Postgres folds into a once-per-statement InitPlan, not a per-row re-evaluation. The new subquery needs
supporting indexes on `program_workers(worker_id)` and `program_participants(program_id)`.

**Untouched, and asserted as such (§2 point 4 above):** `client_ids_for_family()`, `client_ids_for_recipient()`,
and the `client_circle` therapist-access path. None of these reference programs at all, before or after
this migration. Verification must prove this by direct comparison, not by omission.

---

## 5. `program_id` on records

Nullable column, added now, on **three** tables — two from the original spec plus one addition:

- `log_entries`
- `behaviour_notes`
- `incidents` — **added beyond the original spec.** The dashboard program filter (§6) must filter the
  open-incidents card consistently with every other panel (team-mode-spec §2.3: "changing the dashboard
  program filter changes every panel consistently"), and incidents have no way to know their program
  without this column. Cheap now, awkward to retrofit once incident rows exist.

`shifts.program_id` is **not** part of this migration — the table doesn't exist until Rostering is built.
Noted here only so Rostering's own design cycle knows the access-control question (program membership
already governs worker↔participant visibility by the time Rostering ships) is answered, not reopened.

Population rule: see §2 point 5 above. Applies to the worker log form, the coordinator log form, and the
behaviour-note form. The picker renders only on genuine ambiguity (more than one candidate) — the common
case (single-program participant, or a family/coordinator author) stays a silent, zero-friction save,
preserving the app's fast quick-log design.

---

## 6. UI surfaces (v1 scope only — see §2 point 6 for what's deferred)

1. **Program management** — new coordinator-only `/programs` route, guarded by `RequireFeature('programs')`,
   linked from the coordinator dashboard. List view: name, kind badge, colour dot, participant/worker
   counts, active toggle. Tapping a program opens participant/worker assignment panels, reusing
   `ClientManagePanel`'s existing assigned-workers picker interaction rather than inventing a new one.
2. **Dashboard program filter** — `CoordinatorDashboard.tsx` (330 lines, six `useQuery` calls all keyed
   `['…', org_id]`) gains one `programId` state (null = all programs) and a filter chip row. `programId`
   threads into all six query keys and their `where`/`.eq()` predicates, including the incidents card
   (hence `incidents.program_id` above).
3. **Participant roster program tags** — each roster row gets colour-coded chips, one per active program
   the participant attends; a participant in three programs shows three chips, matching team-mode-spec
   §2.3's "appears under both, without duplication."
4. **`program_id` picker** — see §5.
5. **Entitlement plumbing** — `programs` added to `mab-features.json` (published to MAB on deploy, per this
   app's existing feature-declaration convention) and to `src/lib/features.ts`'s `FEATURES` map. The
   `/programs` route, the dashboard filter, and the roster tags all render conditionally on
   `has(FEATURES.programs)`, so none of this appears for a Family/Family + org.

---

## 7. Migrations

Two files, additive-first, matching the discipline established in this morning's `068`–`072` sub-role work
(explicit RLS + grants on every new table — `060`'s `alter default privileges ... grant ... to authenticated`
makes a bare `create table` in this schema world-writable by default; every function pins
`search_path = ''` or the schema-qualified equivalent; every RPC checks `my_role() = 'coordinator'` **and**
`org_id = my_org_id()` on every argument).

- **`073_programs_infrastructure.sql`** — `programs`, `program_participants`, `program_workers`; the
  `clients(id, org_id)` unique constraint if not already present; RLS on all three new tables
  (coordinator-only write, org-scoped read for everyone in the org); the `client_ids_for_worker()` rewrite;
  nullable `program_id` on `log_entries`, `behaviour_notes`, `incidents`.
- **`074_programs_rpcs.sql`** — `create_program` / `update_program` / `archive_program`,
  `assign_participant_to_program` / `remove_participant_from_program`,
  `assign_worker_to_program` / `remove_worker_from_program`. Same two-check shape as `create_sub_role` et
  al. from `068`: `if my_role() <> 'coordinator' then raise exception 'forbidden'`, and
  `org_id = my_org_id()` verified on every id argument before any write.
  **Plus a fix to an existing function:** `remove_member` (last rewritten in `069`) deletes
  `client_workers` / `client_family` / `client_circle` rows when detaching a member, but knows nothing
  about programs. Without adding `delete from companion.program_workers where worker_id = p_user_id` and
  the matching `program_participants` cleanup, a removed member retains program-derived access to their
  old org's participants — the exact hole `069` was written to close, reopened through the new path. The
  `my_org_id()` test in §4's union is the second line of defence, not a substitute for this.

**Rollout order:** `073` (additive, zero behaviour change) → verify the family/therapist invariant
(§8, item 2) → `074` (RPCs) → frontend deploy → done. No human-attestation gate, unlike this morning's
sub-role retirement — nothing here is being *removed*, so there's no stale-PWA-client hazard to sequence
around.

---

## 8. Verification

**Structural, post-`073` (same three-part pattern as `068`'s own assertions):**
1. Zero new tables missing RLS.
2. Zero non-`SELECT` grants to `anon`/`authenticated` on any new table.
3. Zero new functions that aren't `SECURITY DEFINER` with a pinned `search_path`.
4. **New, specific to this feature:** for a worker with zero `client_workers` rows and zero
   `program_workers` rows, `client_ids_for_worker()` returns an empty set — confirms the union adds
   reachable participants, never grants blanket access as a side effect of a null/missing join.

**Behavioural, direct comparison (not inference):**
5. Add a participant to a program with an assigned family member and a therapist with a live
   `note_shares` row. Re-run `client_ids_for_family()`, `client_ids_for_recipient()`, and the therapist's
   shared-notes query before and after. Row sets must be byte-identical. This is the gap report's
   family/therapist invariant made checkable, not asserted.
6. A worker staffing Program A only cannot see a participant solely in Program B (direct RLS probe, same
   style as this morning's §5.2 direct-API tests — sign in as that worker, query `clients`, confirm the
   B-only participant is absent).
7. A participant in both A and B is visible to workers of either program.
8. Removing a participant from Program A (`left_at` set) does not remove them from Program B or from the
   org.
9. Dashboard filter: toggling `programId` changes every panel's result set consistently, including the
   incidents card.

**Performance:**
10. `explain (analyze, buffers)` on a representative `log_entries` or `clients` query as a worker with both
    direct and program-derived access, confirming `client_ids_for_worker()` still resolves as a one-time
    InitPlan, not a per-row call — the same check this morning's plan ran for `has_perm()`.

---

## 9. Explicitly out of scope for this cycle

- Rostering (`shifts`, `shift_participants`, `shift_handovers`) — separate design cycle, depends on this one.
- NDIS reporting/compliance (`record_revisions`, `restrictive_practices`, `behaviour_support_plans`, a real
  audited `exports` subsystem) — separate cycle. Current export capability is one client-side CSV button
  scoped to behaviour notes only, gated on `ndis_exports`, with no PDF, no goals/medication content, no
  program scoping, and no `access_log` write despite that being required elsewhere in the spec. Confirmed
  by direct code inspection 2026-08-24, not assumed.
- The two other missing entitlement keys (`ndis_records`, `rostering`) — added when their respective
  features are built, not speculatively now.
- Family +/Enterprise commercial tiers, six-tier pricing card updates — unrelated to Programs' technical
  design; `planCheck.ts` already half-references `companion_family_plus`, worth a follow-up look when that
  work is picked up.
- The open billing-metering question (per-seat vs. `active_clients` usage meter, `Companion-Gap-Report.md`
  §"Open question") — irrelevant to Programs' technical design (Programs' own billing surface, the
  per-program cost breakdown, is explicitly deferred per §2 point 6), but must be resolved with David
  before any billing-counting code is written in a future cycle.

### 9.1 The same participant in two organisations (known limitation, own design cycle)

Raised by David 2026-08-24, with a concrete real case: Sarah Younger is a participant in **The Friendship
Circle** (Team plan) *and* has her own private **Companion Family** plan for non-Friendship-Circle
activities. Same human, two commercial entities. She and her family want **one login** showing the whole
picture; the coordinators and workers of each entity must stay **strictly separated**. Therapists are
common to the participant, not to either org.

**Not addressed by this spec, and not blocking it.** Programs is entirely org-internal:
`program_participants` points at an org-scoped `clients` enrolment row and remains correct whether or not
that row later gains person-level identity. Building Programs first does not constrain this decision.

State of the world, verified by direct policy inspection 2026-08-24 (not assumed):

| Path | Cross-org today? | Why |
|---|---|---|
| Therapist sees shared notes | **Already works** | `"therapists see only explicitly shared notes"` (`004`/`013`) is a bare `note_shares` note→therapist grant with **no org test** on either side |
| Decision-maker shares a note | **Appears to work** | `"decision_maker can share notes"` gates on `c.decision_maker_id = auth.uid()` — a participant-level property, no org test; `therapist_id` is unconstrained by org |
| Family / recipient views journal | **UNVERIFIED — the crux** | `client_ids_for_family()` / `client_ids_for_recipient()` bodies not yet inspected for org tests |
| One login spanning both orgs | **Hard blocker** | `profiles.org_id` is a single nullable column and `public.my_org_id()` returns a scalar |

The useful discovery is that the *clinician* layer — the most privacy-sensitive and the part that looked
hardest — is already person-scoped by construction. The remaining work is narrower than a full
person-identity rebuild:

1. Let a family/recipient profile span orgs — either a `profile_orgs` many-to-many, or the cheaper
   `clients.person_id` link where family/recipient **read** paths union across linked enrolments while
   worker/coordinator paths stay untouched. The participant or decision-maker asserts the link (they are
   the data subject); **neither provider need ever learn the other exists**.
2. Verify and, if necessary, relax the family/recipient read paths. Security-sensitive — needs its own
   review pass, not an assumption.

Note also that `profiles.org_id` being singular is why the same person acting as decision-maker for both
orgs currently needs two logins on two email addresses — the sharing *policies* would permit one profile
to act across both, but there is no way for that profile to be a member of both orgs.

Team-Mode-Spec §1 asserts *"a user with roles in two orgs must pick an active org; all queries scope to
that `org_id`"* — that is aspirational, not implemented; nothing in the codebase supports multi-org
membership.

**Unrelated data hygiene, flagged while investigating:** there are currently **two** organisations both
named `The Friendship Circle` on `companion_team_workers` (`87f8899c-4ab0-4e4c-9520-2738ac8ec74b`, 0
people; `a853f423-4fa8-4e82-918a-c36e851b3fc9`, 1 person, 0 participants). Duplicate-named orgs will make
this scenario very hard to reason about or test. Worth resolving before Programs is exercised against it.

---

## 10. Residual risks

1. **`client_ids_for_worker()`'s live body may not match the migration file text.** `060`'s schema-move
   sweep rewrote several function bodies in place without updating the source files (confirmed the hard
   way three times this morning, in `069`). The union rewrite in §4 must be diffed against
   `pg_get_functiondef` before it's pasted, not trusted from this document or the migration file.
   **This risk already materialised once, in this very spec** — see the warning under §4.
2. **`profiles` has no `(id, org_id)` unique key**, so `program_workers`' org integrity rests on RPC
   discipline rather than a composite FK, unlike `program_participants`. A service-role edge function or a
   hand-written SQL-editor insert could create a `program_workers` row whose `org_id` disagrees with the
   worker's actual `profiles.org_id`. The `my_org_id()` test in §4's union means such a row grants no
   access, so this is an integrity wart rather than an access hole — but it is a real asymmetry, and adding
   `unique (id, org_id)` to `profiles` to close it properly is worth considering during implementation.
3. **No live provider-tier org exists to test against.** Every verification query in §8 will run against
   freshly-created test data, not a real org's real usage pattern — same caveat this morning's plan carried
   for the sub-role work, mitigated the same way (careful direct-API probes rather than "it looked fine in
   the UI").
4. **Three defects were found in this spec by adversarial review after it was first written** (the §4 org
   test, the missing `clients(id, org_id)` constraint, the `remove_member` program cleanup). All three are
   now corrected inline above. The lesson worth carrying: this document is a design, not a verified
   artifact — the pre-paste `pg_get_functiondef` reconciliation and the §8 verification queries are what
   make it safe, not its own confidence.
