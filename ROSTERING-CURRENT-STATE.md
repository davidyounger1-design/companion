# Rostering / Shift-Scheduling — Current State Map

Repo: `C:/Temp/companion-shift-cancel-delete` (worktree, branch `fix/delete-cancelled-shift`, HEAD `71b5d44`
"Allow deleting a cancelled shift" — one commit ahead of what's on `master`/deployed at the time of writing;
noted inline wherever it changes a fact from what the 093/094/095 migration files alone would suggest).

All facts below are cited `file:line`. Design-intent facts (what was *planned*) are drawn from
`docs/superpowers/specs/2026-08-24-programs-design.md` and `docs/superpowers/specs/2026-08-24-rostering-design.md`
and are always labeled as design-doc claims, separate from what the shipped code actually does.

---

## 0. Headline finding (read this first)

**The Rostering feature, as it exists in `src/` today, cannot be used end-to-end by a coordinator**,
because the one write path the whole feature depends on — assigning workers and participants to a
program — has no UI anywhere in the app.

- `companion.assign_worker_to_program`, `companion.remove_worker_from_program`,
  `companion.assign_participant_to_program`, `companion.remove_participant_from_program`,
  `companion.update_program`, and `companion.archive_program` all exist as RPCs
  (`supabase/migrations/092_programs_rpcs.sql:60-131`) and are fully typed in
  `src/types/database.ts:1238-1261`, but **grepping all of `src/` for their names finds zero call sites**
  outside `database.ts` itself.
- The design spec that scoped this (`docs/superpowers/specs/2026-08-24-programs-design.md:224-227`)
  called for a dedicated coordinator-only `/programs` route with participant/worker assignment panels,
  explicitly planned to reuse `ClientManagePanel`'s existing picker interaction
  (`src/components/ClientManagePanel.tsx` — confirmed zero references to "program" anywhere in that file).
  That route was never built: `src/App.tsx` has no `/programs` route, and no coordinator page other than
  `Rostering.tsx` mentions "program" at all (`CoordinatorDashboard.tsx`, `CoordinatorClientDetail.tsx` — zero
  matches).
- The only program-related write the UI ever performs is `create_program`, from a small inline modal
  embedded in the Rostering page itself (`src/pages/coordinator/Rostering.tsx:709-753`,
  RPC call at `:720-722`). It creates an empty program shell with no workers and no participants attached,
  and there is no follow-up step to add either.
- Net effect: a coordinator can create a program, but the resulting program has `program_workers` = 0 rows
  and `program_participants` = 0 rows forever (short of someone hand-writing SQL), so the week grid shows no
  worker rows, "+ Add shift" has no worker/participant options, and shift creation
  (`rostering_create_shift`) — which validates the chosen worker/participants are program members
  (`094_rostering_rpcs.sql:30-43`) — has nothing valid to submit.
- This is a **regression from what was approved**, not an ambiguous scope call: the design doc lists program
  management, the dashboard program filter, and participant-roster program tags all as **v1, in-scope**
  deliverables (`programs-design.md:222-239`, "§6 UI surfaces (v1 scope only)"), explicitly distinguishing
  them from a separate, later-deferred list (§2 point 6 / §9). Only the schema and RPCs (091/092) shipped;
  three of the five listed UI surfaces did not.

Everything below documents the feature as it stands, including this gap in context.

---

## 1. Data model

Schema: `companion` (Postgres, Supabase). Six rostering tables in
`supabase/migrations/093_rostering_infrastructure.sql`, plus the three "programs" foundation tables in
`091_programs_infrastructure.sql` that rostering hangs off.

### 1.1 `companion.programs` (091:38-47)
| Column | Type | Nullability / default | Notes |
|---|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` | |
| `org_id` | uuid | not null, FK → `organisations(id)` on delete cascade | |
| `name` | text | not null | |
| `kind` | text | not null, `check (kind in ('day_program','group_home','in_home','community_access','other'))` | |
| `colour` | text | nullable | hex, for future UI colour-coding — not currently rendered anywhere (no colour picker in `CreateProgramModal`, `colour` always passed as `null`, `Rostering.tsx:721`) |
| `active` | boolean | not null, default true | soft-deactivate only, no `deleted_at` — history (participants/workers/shifts) stays intact when archived (`092_programs_rpcs.sql:46-47`) |
| `created_at` | timestamptz | not null, default now() | |
| — | — | `constraint programs_id_org_uk unique (id, org_id)` | enables composite FKs from `program_participants`/`program_workers`/`shifts`/`shift_templates` |

Index: `programs_org_idx (org_id)` (091:49).

### 1.2 `companion.program_participants` (091:65-77)
`program_id`, `participant_id`, `org_id` (all not null) — composite PK `(program_id, participant_id)`.
`joined_at` (default now()), `left_at` (nullable — **soft-remove**: "leaving one program must not affect
others", 091:70/programs-design.md:95). FKs are **composite**: `(program_id, org_id) → programs(id, org_id)`
and `(participant_id, org_id) → clients(id, org_id)`, both `on delete cascade` — this makes an org-A
participant landing in an org-B program **structurally unexpressable**, not just RPC-checked
(091:64-68, design rationale at programs-design.md:116-120).

### 1.3 `companion.program_workers` (091:90-101)
`program_id`, `worker_id`, `org_id` (not null) — composite PK `(program_id, worker_id)`. `assigned_at`
(default now()), `removed_at` (nullable soft-remove). Only **one** composite FK here —
`(program_id, org_id) → programs(id, org_id)` — `worker_id` is a **plain** FK-less reference to
`profiles(id)` (091:97-100 comment: "`profiles` has no `(id, org_id)` unique key yet; org match is enforced
in the assignment RPC"). This is a **deliberate asymmetry** vs. `program_participants` and is called out as
"residual risk" in both the migration comment and `programs-design.md:129-132,377-382`: a
service-role/edge-function/SQL-editor insert could create a `program_workers` row whose `org_id` disagrees
with the worker's real org — it just wouldn't grant any access, because every read path re-tests
`org_id = my_org_id()`.

### 1.4 `companion.shift_templates` (093:15-28)
| Column | Type | Nullability / default | Notes |
|---|---|---|---|
| `id` | uuid | PK | |
| `org_id` | uuid | not null, FK org cascade | |
| `program_id` | uuid | not null | composite FK `(program_id, org_id) → programs(id, org_id)` cascade |
| `worker_id` | uuid | **not null**, FK → `profiles(id)` on delete **restrict** | **"v1 lite: templates always coordinator-assigned, never open"** (093:19) — no open/unassigned recurring templates are possible, unlike one-off shifts |
| `day_of_week` | int | not null, `check (0..6)` | **single int — one template covers exactly one weekday**; a Mon–Fri recurring shift needs 5 separate template rows |
| `starts_time` / `ends_time` | time | not null; `check (ends_time > starts_time)` | no overnight (cross-midnight) shift templates possible |
| `end_date` | date | nullable | null = generates indefinitely |
| `participant_ids` | uuid[] | not null, default `'{}'` | carried onto each generated shift verbatim |
| `active` | boolean | not null, default true | pause/resume without deleting |
| `created_at` | timestamptz | not null, default now() | |

Index: `shift_templates_org_program_idx (org_id, program_id)` (093:30).
Note: **no `required_skills` column on templates at all** — generated shifts never carry required skills
(moot in practice — see §6 below, `required_skills` isn't wired up from the UI on one-off shifts either).

### 1.5 `companion.shifts` (093:33-53) — the core entity
| Column | Type | Nullability / default | Notes |
|---|---|---|---|
| `id` | uuid | PK | |
| `org_id` | uuid | not null, FK org cascade | |
| `program_id` | uuid | not null | composite FK `(program_id, org_id) → programs(id, org_id)` cascade |
| `worker_id` | uuid | **nullable**, FK → `profiles(id)` on delete restrict | null = open/unassigned shift (job board) |
| `is_open` | boolean | not null, default false | `constraint shifts_open_worker_null check (not is_open or worker_id is null)` — is_open and worker_id are kept structurally consistent (093:38,51) |
| `required_skills` | text[] | not null, default `'{}'` | see §6 — collected in the create/edit UI but never actually persisted through either creation RPC (bug, detailed below) |
| `template_id` | uuid | nullable, FK → `shift_templates(id)` on delete **set null** | link back to the generating template; surviving after template delete |
| `starts_at` / `ends_at` | timestamptz | not null; `check (ends_at > starts_at)` | no zero/negative-length shifts |
| `status` | text | not null, default `'draft'`, `check (status in ('draft','published','confirmed','in_progress','completed','cancelled'))` | see §2 status machine |
| `notes` | text | nullable | coordinator note; a cancellation reason is also written here (overwrites, not appends — see §5 gaps) |
| `override_note` | text | nullable | coordinator's justification for creating/editing a shift despite an overlap warning |
| `created_by` | uuid | **not null**, FK → `profiles(id)` on delete restrict | |
| `created_at` | timestamptz | not null, default now() | |
| `updated_at` | timestamptz | nullable | set on every transition |
| `deleted_at` | timestamptz | nullable | **soft-delete only — comment states "never hard-delete"** (093:49) |

Constraints: `shifts_id_org_uk unique (id, org_id)` (enables `shift_participants`' composite FK).
Indexes: `shifts_template_starts_uk` **unique** `(template_id, starts_at) where template_id is not null`
(idempotent-generation guard, 093:55); `shifts_org_program_starts_idx`, `shifts_worker_starts_idx`,
`shifts_org_status_idx`, `shifts_open_job_board_idx (org_id, is_open, status) where is_open` (093:56-59).

### 1.6 `companion.shift_participants` (093:62-70)
`shift_id`, `participant_id`, `org_id` (not null) — composite PK `(shift_id, participant_id)`.
`left_at` nullable — soft-remove, "keeps history" (093:66). Composite FKs both ways, `on delete cascade`
from `shifts` and from `clients`. Index `shift_participants_participant_idx (participant_id)`.

### 1.7 `companion.shift_handovers` (093:75-87) — append-only
`id`, `shift_id` (FK cascade), `author_id` (FK restrict), `body` (nullable text), `nothing_to_hand_over`
(not null, default false), `created_at`. `constraint handover_body_xor check ((body is null or body = '')
= nothing_to_hand_over)` — enforces exactly one of "a note" or "nothing to hand over", never both, never
neither, at the DB layer, not just in the RPC. **Comment states explicitly: "append-only: written once by
rostering_end_shift (or coordinator force-end); no UPDATE/DELETE path ever exists — no revision trigger
either"** (093:83-84). Confirmed structurally: no RLS write policy, no grant for insert/update/delete to
`anon`/`authenticated` (093:254-266) — the only writer is the `SECURITY DEFINER` RPC.
Index: `shift_handovers_shift_created_idx (shift_id, created_at desc)`.

### 1.8 `companion.worker_availability` (093:90-97)
`worker_id`, `org_id`, `day_of_week` (check 0-6), `starts_time`, `ends_time` (check end>start). **Composite
PK `(worker_id, day_of_week)` — "v1 lite: one window per weekday, not multiple ranges"** (093:96). A worker
who is available 9-12 AND 14-17 on the same day cannot express that; only one contiguous window per day.
Index `worker_availability_org_idx`.

### 1.9 `companion.profile_skills` (093:102-107)
`profile_id`, `org_id`, `skill` (text) — composite PK `(profile_id, skill)`. Free-text skill tags, no
controlled vocabulary/lookup table — a coordinator typing "manual handling" and a worker typing "Manual
Handling" will not match (string equality only, see the skills-match check in the UI, §5 below).
Index `profile_skills_org_skill_idx (org_id, skill)`.

### 1.10 Status enum and its single home
`shifts.status`, six values: `draft`, `published`, `confirmed`, `in_progress`, `completed`, `cancelled`
(093:43, mirrored in `src/lib/rostering.ts:4` as the `SHIFT_STATUSES`/`ShiftStatus` TS union — the only two
places the enum is spelled out; kept in sync by hand, no shared codegen for the check constraint itself).
Transitions are covered fully in §2.

---

## 2. RPC surface

All rostering RPCs live in `companion` schema, `SECURITY DEFINER`, pinned
`set search_path = 'companion', 'public'`. Every one begins with
`if not public.org_has_feature('rostering') then raise exception ...` as the **only** thing stopping a
downgraded org's direct RPC call, since `SECURITY DEFINER` bypasses RLS (094:1-10 header comment). Every
status transition is a **conditional UPDATE** (`where id = X and status = <legal-from>`); an affected-row
count of 0 is treated as "invalid transition" — never check-then-write (094:9-10).

### 2.1 Program CRUD (092)
| RPC | Actor check | Effect | UI call sites |
|---|---|---|---|
| `create_program(name, kind, colour)` (092:13-28) | coordinator only | inserts a `programs` row | `Rostering.tsx:720-722` (only) |
| `update_program(id, name, kind, colour)` (092:31-43) | coordinator, org-scoped | updates name/kind/colour | **none** |
| `archive_program(id)` (092:48-57) | coordinator, org-scoped | soft-deactivate (`active=false`) | **none** |
| `assign_participant_to_program(program_id, participant_id)` (092:60-79) | coordinator | upsert into `program_participants`, clears `left_at` on conflict | **none** |
| `remove_participant_from_program(program_id, participant_id)` (092:81-94) | coordinator, org-scoped | sets `left_at = now()` | **none** |
| `assign_worker_to_program(program_id, worker_id)` (092:97-116) | coordinator | upsert into `program_workers`, clears `removed_at` on conflict | **none** |
| `remove_worker_from_program(program_id, worker_id)` (092:118-131) | coordinator, org-scoped | sets `removed_at = now()` | **none** |

("**none**" = confirmed via full-repo grep, §0 above; these five RPCs are dead from the frontend's
perspective today.)

### 2.2 Shift lifecycle (094)
| RPC | Actor | Legal `status` (from) | Sets `status` to | Notes / guards |
|---|---|---|---|---|
| `rostering_create_shift(program_id, worker_id, starts_at, ends_at, participant_ids, notes, override_note)` (094:15-65) | coordinator | n/a (insert) | `draft` (implicit — column default; not set explicitly, and there is **no `p_status` argument at all**) | Validates: program exists in caller's org; if `worker_id` given, that worker actively staffs the program (`program_workers.removed_at is null`); every participant is actively in the program (`program_participants.left_at is null`). If `worker_id` is set, takes `pg_advisory_xact_lock(hashtextextended(worker_id, 0))` then checks for an overlapping non-cancelled/non-completed shift for that worker — raises `'shift overlaps an existing shift for this worker'` **unless `override_note` is non-blank**. `is_open` is derived (`worker_id is null`), never a caller-supplied flag. |
| `rostering_update_shift(shift_id, worker_id, starts_at, ends_at, participant_ids, notes, override_note)` (094:68-121) | coordinator | **`draft` only** — `if v_status <> 'draft' then raise exception 'schedule edits only allowed while draft'` (094:82) | stays `draft` | Same staffing/overlap validation as create, re-run under the same advisory lock, excluding the shift's own id from the overlap check. Deletes and re-inserts all `shift_participants` rows (full replace, not diff). |
| `rostering_delete_shift(shift_id)` (094:124-135, **superseded by 097** — see below) | coordinator, org-scoped | originally `draft`/`published`/`confirmed`; **as of migration 097 (uncommitted-to-master, this branch's own fix) also `cancelled`** | `deleted_at = now()` (soft-delete; `status` untouched) | `in_progress` and `completed` shifts can never be deleted — no code path anywhere sets `deleted_at` on those; they are permanent history. |
| `rostering_publish_shift(shift_id)` (094:138-148) | coordinator, org-scoped | `draft` | `published` | Fires the §4 notify trigger (095) — a WHEN clause on the trigger, not this RPC. |
| `rostering_cancel_shift(shift_id, reason)` (094:151-162) | coordinator, org-scoped | `draft`/`published`/`confirmed` | `cancelled` | `notes` is **overwritten** with `reason` (not appended) — any prior coordinator note on the shift is lost the moment it's cancelled. `reason` has **no non-empty validation** anywhere (RPC or UI) — see §7 gaps. `in_progress → cancelled` is explicitly **not a legal transition** ("must terminate with a handover", rostering-design.md:125) — enforced simply by `in_progress` not being in the allowed `status in (...)` list. |
| `rostering_confirm_shift(shift_id)` (094:165-174) | **assigned worker** (no explicit role check — implicitly restricted by `worker_id = auth.uid()` in the WHERE clause) | `published` | `confirmed` | |
| `rostering_claim_shift(shift_id)` (094:177-210) | any worker who actively staffs the shift's program | `published` **and** `is_open` | `confirmed` directly (skips a separate "publish→confirmed" step) | Advisory-locks the *claiming* worker, re-runs the overlap check against the claimer's own other shifts, then atomically sets `worker_id = auth.uid(), is_open = false, status = 'confirmed'`. |
| `rostering_start_shift(shift_id)` (094:213-232) | assigned worker | `published` or `confirmed` | `in_progress` | **Start-window guard**: `now()` must be `>= greatest(starts_at - 2h, day_trunc(starts_at))` and `<= ends_at`, else `'outside the allowed start window for this shift'`. The `greatest(...)` clamp means a very-early shift (e.g. 06:00) can be started any time from local midnight, not just 2h before. |
| `rostering_end_shift(shift_id, handover_body, nothing_to_hand_over)` (094:235-265) | assigned worker **or coordinator** (`v_actor <> v_worker and my_role() <> 'coordinator'` → forbidden) | `in_progress` | `completed` | Coordinator "force-end" is a deliberate, documented deviation ("DECISION Q-A, Option 1... breaks the author-is-worker invariant deliberately", 094:247-249) — `shift_handovers.author_id` becomes the coordinator's id, not the worker's. XOR-validates body vs. `nothing_to_hand_over` (also DB-enforced by the CHECK). Writes the handover row in the **same transaction** as the status flip. **No UI ever calls this for a coordinator** — see §7. |
| `rostering_copy_forward(source_week, target_week)` (094:268-320) | coordinator | `draft`/`published`/`confirmed` shifts in the source week | new rows, always **`draft`** (status not set on insert → column default) | Per source shift: skip if the worker no longer staffs the program; skip (don't abort) if the shifted time overlaps an existing target-week shift for that worker (advisory-locked per worker); otherwise insert a new shift `+7-day-multiple` offset, carrying `required_skills`, `notes`, and participants (via a `shift_participants` sub-select) — but **not** `override_note`. Returns `{created, skipped}` counts, no detail on *which* were skipped. |
| `rostering_week_grid(week_start, program_id)` (094:323-348) | coordinator, org-scoped | (read) | — | Returns the week's shifts for one program joined to worker name + participant list, as JSON. |
| `rostering_warnings(week_start, program_id)` (094:351-391) | coordinator, org-scoped | (read) | — | Three independent computations: **W1 overlaps** (any two non-cancelled/non-completed shifts for the same worker whose times intersect, within the week); **W2 uncovered** (a program participant with zero non-cancelled/non-completed shift coverage on a given day — "a shift with no participants covers no one" per design doc, i.e. a shift's mere existence doesn't count unless the participant is actually attached); **W3 unconfirmed** (`published` **and not `is_open`** shifts in the week — deliberately excludes open/job-board shifts, since an unclaimed shift surfaces via the job board's own count, not this warning). |
| `rostering_previous_handover(program_id, participant_ids, before)` (094:394-427) | any worker staffing the program | (read) | — | Finds the most recent handover on a `completed` shift of the same program that shares ≥1 participant and started before `before`; if none shares a participant, **falls back** to the most recent same-program handover regardless of participant overlap, flagged `fallback_no_shared_participants: true` in the response. |
| `rostering_set_availability(days jsonb)` (094:430-444) | any authenticated user (own) | (replace-all) | — | Deletes **all** of the caller's `worker_availability` rows, then re-inserts the supplied array. No partial update path — every save is a full replace. |
| `rostering_set_skills(skills text[])` (094:447-461) | any authenticated user (own) | (replace-all) | — | Same replace-all pattern for `profile_skills`; trims each skill string, `on conflict do nothing` for dupes. |
| `rostering_create_template(...)` (094:464-495) | coordinator | (insert) | — | Same staffing/participant validation as `rostering_create_shift`. **No overlap check against the worker's existing shifts or other templates at all** — see §7 gaps. |
| `rostering_update_template(...)` (094:497-530) | coordinator, org-scoped | (update) | — | Same validation as create; also no overlap check. |
| `rostering_pause_template(id, active)` (094:532-541) | coordinator, org-scoped | — | toggles `active` | A paused template stops generating new shifts; already-generated shifts are untouched. |
| `rostering_delete_template(id)` (094:543-551) | coordinator, org-scoped | — | **hard**-deletes the template row | Generated shifts survive (`template_id` FK is `on delete set null`) — "the shifts themselves are never touched" (rostering-design.md:189). |

### 2.3 `rostering_delete_shift` — the branch's own uncommitted-to-master fix (migration 097)
Migration `097_rostering_delete_cancelled_shift.sql` (this branch only, commit `71b5d44`) widens
`rostering_delete_shift`'s legal-from list from `('draft','published','confirmed')` to
`('draft','published','confirmed','cancelled')` (097:22-30). Matched by the same commit's UI change,
`Rostering.tsx:641` (delete button condition widened to include `cancelled`). **This is the one place
where the code on disk differs from what the 094/097 migration numbering alone would suggest** — treat
"cancelled shifts are permanently stuck" as **no longer true** on this branch, though it is still true as
of migration 094 alone / on `master` until 097 merges.

### 2.4 `remove_member` — rostering's refusal clause (094:560-627, supersedes 092:144-189)
`remove_member(user_id)` is not a rostering RPC per se, but 094 re-`create or replace`s it (096/097 don't
touch it further) to add a rostering-aware refusal **before** the existing client/program detach logic:
- Refuses (returns `{ok:false, error:...}`, does not raise) if the target has **any future assigned shift**
  (`starts_at >= now()`, `status not in ('cancelled','completed')`) as either `worker_id` or `created_by`
  (094:586-593). Note: **`in_progress` counts as blocking** (it's not `cancelled`/`completed`) — combined
  with §7's "no UI force-end" gap, a worker whose shift is stuck `in_progress` forever can never be removed
  from the org through the app.
- Also refuses if the target authored a handover on a shift that is somehow not `status = 'completed'`
  (094:596-603) — commented as a defensive check for a state that "structurally shouldn't happen" since
  `rostering_end_shift` writes both atomically.
- **Open (unassigned) shifts never block** a departure — the check is scoped to rows where the departing
  member is actually `worker_id` or `created_by`.
- If neither check trips, proceeds to delete `client_workers`/`client_family`/`client_circle` rows, null out
  `clients.recipient_profile_id`/`decision_maker_id`, delete `program_workers`, soft-leave
  `program_participants` for any client the departing member was the recipient of, then null the profile's
  `org_id`/`sub_role_id` (094:605-620).

---

## 3. RLS / permissions model

All six rostering tables (`shifts`, `shift_participants`, `shift_handovers`, `shift_templates`,
`worker_availability`, `profile_skills`) plus the three programs tables: **select-only RLS, no
insert/update/delete policy anywhere** — every write goes through the `SECURITY DEFINER` RPCs above
(093:127-266, 091:51-115). `revoke insert, update, delete ... from anon, authenticated` is explicit on
every table (093:254-259) because `060`'s schema-wide default-privilege grant would otherwise make a bare
`create table` world-writable (093 comment cross-referencing that history).

| Table | Coordinator sees | Worker sees | Family / recipient / therapist / decision-maker |
|---|---|---|---|
| `shifts` | all shifts in own org, `deleted_at is null` (093:135-138) | **own shifts only**, and only in status `published`/`confirmed`/`in_progress`/`completed` — **`draft` and `cancelled` are never worker-visible** (093:140-143) | none of the three roles have a `shifts` policy at all |
| `shifts` (job board) | n/a (coordinator already sees everything) | open (`is_open`), `published`, non-deleted shifts **in a program the worker staffs** (via `worker_program_ids()`) (093:145-149) | — |
| `shift_participants` | org-scoped (093:151-154) | only rows for shifts that are the worker's own AND in the same visible-status set as above, and only where `left_at is null` (093:156-166) | none |
| `shift_handovers` | any handover on a non-deleted shift in the coordinator's org (093:168-174) | any handover on a shift that is either the worker's own, **or** in a program they staff (093:176-185) — this is deliberately **program-wide**, not just "my shifts", so the *next* worker on that program can read the *previous* worker's handover before their first log entry (design intent, rostering-design.md:152) | **none — by design.** Confirmed structurally: no family/recipient/therapist policy exists on `shift_handovers` at all, and the family digest query (`FamilyDashboard.tsx`, per rostering-design.md:232-233) never joins this table. This is the mechanism keeping handovers out of the family-facing daily digest. |
| `shift_templates` | org-scoped, coordinator only (093:187-190) | **no read policy at all** — "workers never see templates directly, only the shifts they generate" (093:191-192, explicit code comment) | none |
| `worker_availability` | org-scoped read (093:199-202) | own rows only (093:194-197) | none |
| `profile_skills` | org-scoped read (093:209-212) | own rows only (093:204-207) | none |
| `programs` / `program_participants` / `program_workers` | any org member can **select** (091:56-59,81-84,109-112 — `org_id = my_org_id()`, no role check) — i.e. workers/family/etc. can read program membership rows too, just not write them | same (org-wide select) | same |

**Entitlement gate**, restrictive, on all six rostering tables (not the three programs tables — see below):
`as restrictive for all to authenticated using ((select public.org_has_feature('rostering'))) with check
(...)` (093:214-251). This is a second, independent layer beneath the permissive policies above — an org
without the `rostering` MAB feature key gets zero rows and zero writes even via a raw PostgREST call,
regardless of role. The `(select ...)` wrapping is deliberate — folds into a once-per-statement InitPlan
rather than a per-row re-evaluation (093:215-216 comment, referencing the same pattern from migration 076).

**Programs tables have no entitlement gate at all**, by explicit design choice: "Deliberately NOT in this
migration: the `programs` MAB entitlement key and gate... this is the headless prerequisite Rostering's
schema depends on, not a shipped product surface yet" (091:18-25). Confirmed: `mab-features.json` has no
`programs` key (only `rostering`), and `src/lib/features.ts:31-46`'s `FEATURES` map has no `programs` entry
either. In practice this means program create/read is only reachable at all because it's nested inside the
`rostering`-gated `/rostering` route — there's no independent gate stopping a coordinator whose org somehow
had `rostering` off but reached the RPC directly (though the RLS select-policies would still show it nothing
useful without workers/participants attached).

**Server-side gate is layered, UI gate is separate**: every rostering RPC also independently checks
`org_has_feature('rostering')` as its first line (094, throughout) — this is what stops a *direct* RPC call
from a downgraded org even though `SECURITY DEFINER` bypasses RLS (094:6-10 header). The UI layer
(`useFeatures().has(FEATURES.rostering)`, gating the `/rostering` route and every worker shift surface) is a
third, independent layer on top of both — described as fail-closed by design ("the hook returns an empty Set
while loading/on error, so 'absent' is the default", `features.ts:9-11`).

---

## 4. Notifications

One trigger, one edge-function branch, both from migration 095:

- **Trigger**: `companion.notify_push_on_shift_publish` (095:31-53), `after update on companion.shifts`,
  `for each row`, gated by a `WHEN` clause: fires only on `draft→published` **or**
  `(published|confirmed)→cancelled` (095:59-61). Editing `notes` on an already-published shift never
  re-fires it. On any internal error the trigger swallows it (`exception when others then return new`) —
  **a failed push notification never blocks the underlying status transition** (095:49-52).
- **Payload**: `POST` to the `push-notify` edge function with `{record: row_to_json(new), type: 'shift'}`,
  authenticated with the Vault-stored `service_role_key` (095:37-47) — same hardcoded-URL-plus-Vault-key
  pattern as two earlier features (034, 085), explicitly flagged in the migration's own header comment as
  **unverified in this exact trigger-context ("first place in the repo doing this from a normal AFTER
  UPDATE trigger fired inside a user's own RPC transaction... verify with a real publish before relying on
  it", 095:12-19)** — i.e. as of writing, nobody has confirmed this actually fires in production.
- **Recipient resolution** (`push-notify/index.ts:108-126`): the `shift` branch targets `push_subscriptions`
  rows for `user_id = record.worker_id` in the shift's org, **excluding** `record.created_by` (relevant only
  if a coordinator is also somehow the assigned worker on their own shift). If `worker_id` is null (an open
  shift being published), the function returns early with "no worker" (`index.ts:113-114`) — **an open
  shift being published never notifies anyone** (nobody to notify — no separate "new open shift available"
  broadcast to the program's other workers exists).
- **Explicitly not implemented, flagged for follow-up**: claim and confirm do **not** trigger any push
  notification. The migration's own comment notes the rostering worklog once mentioned "claim/confirm
  variants" but the finalized design spec only specifies publish/cancel, and flags this as an open question
  for David rather than inventing it (095:21-27). So today: a coordinator publishing an open shift that a
  worker later claims gets **no notification themselves** that it was claimed, and the claiming worker gets
  no push (only the in-app realtime subscription on `shifts`, if the app happens to be open).
- **In-app delivery**: independent of push — the coordinator UI subscribes to `postgres_changes` on
  `companion.shifts` filtered by `org_id` and invalidates the week-grid/warnings queries on any change
  (`Rostering.tsx:121-130`) — this covers claim/confirm/etc. live for anyone with the Rostering page open,
  it's only the push-to-a-closed-app path that's publish/cancel-only.

---

## 5. UI capabilities

### 5.1 Coordinator (`src/pages/coordinator/Rostering.tsx`, 921 lines)
Reached via `/rostering`, gated `RequireCoordinator` + `RequireFeature(FEATURES.rostering)`
(`App.tsx:261`), linked from the dashboard header only when `has(FEATURES.rostering)`
(`CoordinatorDashboard.tsx:152-156`).

**Can do:**
- Pick a program from a dropdown (`Rostering.tsx:212-216`) — populated from `programs` where `active`
  (`:29-39`); auto-selects the first program on load (`:41-43`).
- **Create** a program via a "+ Program" button → inline modal, name + kind only (`:709-753`) — no colour
  picker, no participant/worker assignment step (see §0).
- Navigate week-by-week or jump to "This week" (`:237-241`); view a worker × day grid of shift blocks for
  the selected program and week (`:273-320`), plus a separate "Open shifts" row for unassigned shifts
  per day (`:308-317`).
- See a **warnings panel** (overlaps / no-cover days / unconfirmed count) whenever any of the three
  categories is non-empty (`:252-254`, `WarningsPanel` at `:393-420`).
- See a **week-summary panel** (per-worker total hours, shift count, unconfirmed count), computed
  client-side from the already-fetched week grid — no extra query (`:135-147`, `:256-268`).
- **Create a shift** (`+ Add shift` or the per-cell `+ shift` button, `:245-248`, `:302-303`) via a modal
  that picks a worker (or leaves it as "— Open shift (unassigned) —"), start/end time, a free-text
  "required skills" field, a participant multi-select, and a notes field (`CreateShiftModal`, `:422-560`).
  Surfaces two **non-blocking** warnings inline: no recorded availability for that worker on that weekday
  (`:496-500`), and skills the worker's `profile_skills` don't cover (`:517-521`) — see §6 for why the
  skills one is functionally inert.
- **Edit** a shift, but **only while it's `draft`** — clicking a draft shift block opens the same modal in
  edit mode (`:300`, `s.status === 'draft' ? setEditingShift(s) : setDetailShift(s)`); any other status
  opens the read-only detail modal instead.
- **Drag-and-drop** a shift block to a different worker/day (`:162-201`). For a `draft` shift this calls
  `rostering_update_shift` directly. For anything else it calls `rostering_cancel_shift` (reason hardcoded
  to `'Rescheduled via drag-and-drop'`) then `rostering_create_shift` for the new slot — **the newly
  created shift is always `draft`** (no status argument exists on `rostering_create_shift` — see §7), so
  dragging a `confirmed` shift silently downgrades it to an unpublished, worker-invisible draft until the
  coordinator remembers to manually re-publish it.
- From a shift's **detail modal** (`ShiftDetailModal`, `:562-650`): **Publish** (draft only), **Cancel
  shift** (draft/published/confirmed — prompts a native `prompt()` for a reason, no non-empty validation,
  see §7), **Delete** (draft/published/confirmed/cancelled as of this branch's 097 fix — see §2.3). Can
  view (read-only) any handovers already recorded on that shift.
- **Copy last week forward** into the current week as new drafts (`CopyForwardModal`, `:652-699`), shown a
  created/skipped count afterward but no list of which shifts were skipped or why.
- **Manage recurring templates** via a "Templates" button (`TemplateManagerModal`, `:755-837`): list
  existing templates for the program, **Pause/Resume**, **Delete** (hard-delete, confirmed via native
  `confirm()`), and **create a new template** (`NewTemplateForm`, `:839-921`: worker, day of week, start/end
  time, optional end date, participant multi-select).

**Cannot do (no UI path, despite an RPC existing):**
- Edit or archive a program (`update_program`/`archive_program` — no call site).
- Assign or remove a worker/participant from a program at all (§0 — the load-bearing gap).
- Force-end an `in_progress` shift — `ShiftDetailModal`'s action row has **no button rendered for
  `in_progress` or `completed` status** (`:631-645` — the three `{shift.status === ...}` conditions never
  include `in_progress`), even though `rostering_end_shift` explicitly supports a coordinator caller
  (094:249). An abandoned in-progress shift has no in-app recovery.
- Create a template directly from an existing shift, despite the design spec calling for exactly this
  ("'create template from this shift' on a shift block's detail view", rostering-design.md:204) — no such
  action exists in `ShiftDetailModal`; templates can only be built from scratch in the separate Templates
  modal.
- See a bulk "publish all" action for a week — every draft (whether hand-created, copied-forward, or
  cron-generated from a template) must be opened and published one at a time.

### 5.2 Worker (`src/pages/worker/WorkerShifts.tsx`, 333 lines; plus a dashboard widget in `WorkerClients.tsx`)
Reached via the bottom-nav "Shifts" tab, shown only when `has(FEATURES.rostering)`
(`WorkerLayout.tsx:22,82-85`); the route itself is also wrapped in `RequireFeature` (`App.tsx:277`).

Three tabs (`WorkerShifts.tsx:10,19-24`):
- **My shifts** (`MyShiftsTab`, `:52-132`): lists the worker's own shifts (any status the RLS policy
  exposes — so `published`/`confirmed`/`in_progress`/`completed`, never `draft`/`cancelled`), ordered by
  start time, with program name resolved via a side query. Per shift: **Confirm** (only if `published`),
  **Start shift** (if `published` or `confirmed`), **End shift** (if `in_progress`, opens the
  `HandoverModal`). No cancel/delete option for a worker at all — cancelling is coordinator-only by design.
- **Open shifts** (`OpenShiftsTab`, `:182-234`): lists all `is_open`+`published` shifts visible to this
  worker (i.e. in a program they staff, per RLS), each with a **Claim** button
  (`rostering_claim_shift`) — no filtering/sorting controls, no indication of which program-required-skills
  the worker may be missing on an open shift (the create-shift skills warning is coordinator-side only).
- **Availability & skills** (`AvailabilityTab`, `:236-333`): a 7-row day×time-window grid (checkbox +
  start/end time per day) and a single comma-separated skills text field, both **replace-all saved
  together** via `rostering_set_availability` + `rostering_set_skills` in sequence (`:279-297`) — if the
  first RPC succeeds and the second fails, availability is saved but skills are not, with a single combined
  error message and no rollback of the first call.
- **End shift / handover** (`HandoverModal`, `:134-180`): requires either a non-empty note or the "Nothing
  to hand over" checkbox — client-side validation mirrors the DB's XOR check, not a substitute for it.

**Worker home-screen widget** (`WorkerClients.tsx:106-212`, `TodayShiftCard`): shows today's not-yet-started
`published`/`confirmed` shift (preferring an `in_progress` one if it exists) with a direct **Start shift**
button — note this lets a worker start a shift **without ever tapping Confirm first**, since
`rostering_start_shift` accepts both `published` and `confirmed` as legal "from" states. Also shows the
**previous-handover banner** (via `rostering_previous_handover`) but only before the worker's first log
entry of the shift (`alreadyLogged === false` gate, `:146-154,165`) — matching the design's "before the
first log entry" rule. Once `in_progress`, the card only links to "My shifts" to end it — no end-shift
action inline on the dashboard itself.

**Cannot do:** decline/reject an assigned shift (only claim an *open* one, or confirm an assigned one — no
"I can't do this shift" flow distinct from doing nothing and letting the coordinator notice it's
unconfirmed via warning W3); swap a shift with another worker (explicitly deferred per design doc, §7
below); un-claim a shift once claimed.

### 5.3 Family / recipient / therapist
No UI surface at all — consistent with the RLS model (§3): none of these roles have any rostering table
policy, and no rostering-related component or route references them.

---

## 6. Explicit design limitations (evidenced, deliberate v1 scope cuts)

Quoting the actual comments/constraints, not paraphrasing intent:

1. **`shift_templates.worker_id not null`** — "v1 lite: templates always coordinator-assigned, never open"
   (093:19). No open/job-board recurring templates; every recurring shift needs a named worker up front.
2. **`shift_templates.day_of_week int`, single value** — one template = one weekday; a template covering
   Mon–Fri needs 5 separate rows, each independently paused/edited/deleted (093:20; confirmed by the
   `NewTemplateForm` UI offering a single `<select>` day picker, `Rostering.tsx:880-885`).
3. **`worker_availability` composite PK `(worker_id, day_of_week)`** — "v1 lite: one window per weekday, not
   multiple ranges" (093:96). A split-shift worker (e.g. available 7-9 and 15-18 on Tuesdays) cannot
   represent that; the UI's own availability form enforces this with a single start/end pair per day
   (`WorkerShifts.tsx:311-315`).
4. **`role_in_program` (worker/lead) dropped from the programs schema** — "Specced but never read anywhere
   in either source document's behavioural description... YAGNI; a one-column, backwards-compatible
   addition whenever a real behaviour needs it" (programs-design.md:121-123). Every program worker is
   undifferentiated; there is no "lead worker" concept anywhere in the schema or RPCs.
5. **`profiles` has no `(id, org_id)` unique key**, so `program_workers.worker_id`'s org-correctness rests on
   RPC discipline rather than a declarative composite FK — "a real asymmetry" the design doc flags as worth
   closing later but doesn't (programs-design.md:377-382, 091:97-100).
6. **`shift_handovers` is append-only by explicit decision (Q-B), default "a"**: "stay append-only — the
   audit record is the record; errors are flagged in the next shift's handover instead"
   (rostering-design.md:268). No coordinator edit path exists, and none is planned unless this decision is
   revisited.
7. **Deferred out of v1 entirely** (rostering-design.md:274-282), each with its own one-line rationale in the
   design doc: labour cost rows, timesheet/payroll export, **shift swaps (worker-to-worker)** ("v1 ships
   coordinator-created open shifts + claim only, not peer-to-peer handoff"), GPS clock-in, SCHADS
   award/fatigue warnings, NDIS plan-linked shifts, AI auto-scheduling, time-off/leave integration (only
   recurring weekly *availability* exists — no one-off leave-request table at all).
8. **Week-grid/warnings day-bucketing is UTC-day, not org-local**, because `org_settings` has no timezone
   column: "Org-local bucketing is deferred until org_settings gains a tz column"
   (rostering-design.md:272, `src/lib/rostering.ts:28-29` `weekStartOf` comment confirms the UTC-based
   bucketing rule in code).
9. **Program management, dashboard program filter, and roster program tags were all *in-scope* for v1**
   per the approved design (programs-design.md §6, items 1–3) — unlike the items above, these are not
   documented deferrals; they are scope that was approved but not delivered (see §0 headline finding).

---

## 7. Gaps / rough edges (evidence-based, not speculative)

Ranked roughly by real-world impact:

1. **Programs cannot be staffed or populated from the UI at all — the feature is non-functional end-to-end
   in its current shipped state.** Detailed in §0. This is the single most consequential finding: everything
   else in this document describes a feature whose entry point doesn't exist yet for a real coordinator.

2. **`required_skills` is silently never persisted.** The create/edit shift modal collects a "Required
   skills" free-text field and computes a `missingSkills` warning locally
   (`Rostering.tsx:451-452,517-521`), but:
   - `rostering_create_shift`'s parameter list has no `p_required_skills` argument at all (094:15-18), and
     its `insert into companion.shifts (...)` column list omits `required_skills` (094:56) — the column
     silently takes its `'{}'` default on every single shift ever created through the UI.
   - `rostering_update_shift` has the identical omission (094:68-71, update statement at 111-114).
   - The frontend's own RPC calls confirm this isn't just a migration-file staleness issue: neither
     `handleSave` in `CreateShiftModal` (`:454-480`) nor the drag-and-drop reassignment path (`:181-194`)
     ever sends a `p_required_skills`/`required_skills` key.
   - The only RPC that ever moves a non-empty `required_skills` value is `rostering_copy_forward`
     (094:308), which copies it from a source shift — but since no source shift can ever have a non-empty
     value either, this is copying empty arrays forever.
   - Net effect: the entire "required skills" concept — schema column, UI input, missing-skills warning —
     is decorative. It has never been possible to actually save a required skill on any shift in this
     codebase's history.

3. **Dragging a `published`/`confirmed` shift silently downgrades it to an unpublished draft.** The
   cancel-and-recreate path (`Rostering.tsx:186-194`) calls `rostering_create_shift`, which always creates
   in `draft` status (no status argument exists — see finding 2's sibling fact). A worker who had confirmed
   a shift, reassigned by drag-and-drop, is **cancelled outright** (their old shift row flips to
   `cancelled`) and the *replacement* shift sits as an unpublished, worker-invisible draft until the
   coordinator separately notices and clicks Publish. There is no toast, warning, or forced follow-up step
   telling the coordinator this happened.

4. **No UI path to force-end an abandoned `in_progress` shift**, despite the RPC and the design's own
   DECISION Q-A explicitly building this in for exactly that scenario (094:247-249,
   rostering-design.md:262-266). Compounding effect: `remove_member` refuses to detach a worker with any
   non-cancelled/non-completed assigned shift (094:586-593), and `in_progress` is such a status — so a
   worker who abandons a shift mid-shift (device dies, quits without logging off) cannot be removed from
   the org through the app at all, and the shift itself has zero coordinator actions available in its detail
   modal (`Rostering.tsx:631-645`, no branch covers `in_progress`).

5. **Recurring templates and copy-forward have no overlap validation whatsoever.** Every *manual* shift
   creation/update/claim path (`rostering_create_shift`, `rostering_update_shift`, `rostering_claim_shift`,
   `rostering_copy_forward`'s per-worker target-week check) takes an advisory lock and checks for an
   overlapping shift for that worker. `rostering_create_template`/`rostering_update_template` do neither
   (094:464-530 — no lock, no overlap query at all), and the nightly generator
   `fn_generate_shift_templates()` (093:330-358) just inserts without any check either. Two active templates
   for the same worker with overlapping times will happily generate two colliding `draft` shifts every week,
   surfacing only after the fact via the weekly `rostering_warnings` W1 check — never blocked at the point
   the conflict is created (template setup or nightly generation).

6. **Recurring templates and copy-forward both generate/copy shifts as `draft`, with no bulk-publish
   action anywhere.** Every template-generated shift and every copied-forward shift needs an individual
   coordinator visit-and-click-Publish to ever reach a worker (drafts are never worker-visible, §3), and the
   template generator only ever creates the *single next upcoming* occurrence per active template
   (093:335-343, `v_next_date` computed from `current_date`, not a multi-week horizon) — so a coordinator
   cannot get ahead of the schedule by publishing several weeks in advance even if they wanted to; the row
   to publish literally doesn't exist yet.

7. **Template generation timing can run after a shift's local start time.** The cron job runs at a fixed
   `'5 0 * * *'` **UTC** (093:366-370, comment: "one day ahead of the earliest possible shift start"), but
   `org_settings` has no timezone column anywhere in this codebase (confirmed by the design doc's own §9.3
   admission, rostering-design.md:272). For an Australian org (UTC+10/+11), 00:05 UTC is roughly
   10-11am local — so a template whose local start time is earlier in the day (e.g. a 06:00 shift) can have
   its `shifts` row generated several hours *after* that shift should already be under way, always landing
   as an unpublished `draft` regardless.

8. **`rostering_cancel_shift`'s reason has no non-empty validation, and overwrites rather than appends
   existing notes.** The coordinator UI collects the reason via a bare native `prompt()`
   (`Rostering.tsx:583`), coerced to `''` if the user cancels the dialog (`?? ''`) — there is no
   client-side or RPC-side check requiring a non-blank reason. `rostering_cancel_shift` then does
   `set notes = p_reason` unconditionally (094:158) — any prior coordinator note about the shift is
   destroyed the moment it's cancelled, and an empty-string reason is accepted silently.

9. **`rostering_set_availability` / `rostering_set_skills` are two separate RPC calls with no shared
   transaction**, saved sequentially from one "Save" button (`WorkerShifts.tsx:279-297`): if the
   availability call succeeds and the skills call then fails, the user sees one combined error message with
   no indication that half the save actually went through, and no retry-just-the-failed-half option.

10. **`profile_skills` and shift `required_skills` are free-text with no shared vocabulary** — a coordinator
    typing "Manual Handling" and a worker typing "manual handling" are different strings under the plain
    equality check (`Rostering.tsx:450-452` builds a `Set` from exact skill strings) — though per finding 2
    this specific mismatch is currently moot since `required_skills` can never be non-empty in practice.

11. **`rostering_copy_forward` doesn't carry `override_note` forward**, only `required_skills`/`notes`/
    participants (094:308-309) — a shift that needed a coordinator override to create in the first place
    loses that justification when copied to a new week, even though the same worker-overlap situation could
    recur and need re-justifying.

12. **The push-notify trigger's transaction-context behavior is explicitly unverified** — the migration's own
    header flags this as new, untested ground for this exact combination of `net.http_post` + Vault-secret
    read from inside a normal user-triggered `AFTER UPDATE`, rather than pg_cron's own context (095:12-19).
    No evidence in the repo that this has since been confirmed working.
