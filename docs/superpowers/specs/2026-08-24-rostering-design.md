# Companion — Rostering design (design spec)

Status: ready for build. Grounding: `Companion-Team-Mode-Spec.md` §3 (Rostering & shift handover, `rostering` — Team+).
Dependency: Programs foundation (091/092, `2026-08-24-programs-reslice-proposal.md`, Option 1). Entitlement: `rostering` — NEW key.
Spec-first: migrations/RPCs designed in prose; numbering finalized 2026-08-30 (§8: 093/094/095). Rev 2: adversarial findings folded in (fix round 1).

## 1. Requirements trace

| §3 | Requirement | Where designed |
|---|---|---|
| 3.1 | `shifts` / `shift_participants` / `shift_handovers` model | §2 |
| 3.2 | Week-grid roster view per program | §5 `rostering_week_grid` |
| 3.2 | Create shift; only program-assigned workers selectable | §5 create RPC |
| 3.2 | Publish notifies the assigned worker | §3, §6.2 |
| 3.2 | Three warnings: worker overlap, no cover, published-unconfirmed | §5 `rostering_warnings` |
| 3.2 | Copy-forward last week's roster | §5 `rostering_copy_forward` |
| 3.3 | My shifts; confirm; start; end | §5 RPCs, §3, §5.4 |
| 3.4 | Previous handover shown before logging begins | §5 `rostering_previous_handover` |
| 3.4 | Handover part of participant record, coordinator-visible, NOT in family digest | §4, §7, §6.3 |
| 3.5 | "On shift" display derived from a `shifts` row, never hardcoded | §5.5 |
| 3.5 | Worker cannot be rostered to a program they do not staff | §5 create/update RPCs |
| 3.5 | Publish notifies; confirm records `confirmed` | §3, §6.2 |
| 3.5 | End requires handover note or explicit "nothing to hand over" | §3, §5 `rostering_end_shift` |
| 3.5 | Next worker sees previous handover before first log entry | §5 `rostering_previous_handover` |
| 3.5 | Overlap warning raised, blocked unless coordinator overrides | §3, §5 (`override_note`, advisory lock) |
| 3.5 | All rostering surfaces absent when `rostering` is off — coordinator `/rostering` route AND every worker surface (My shifts, confirm/start/end, home shift card, on-shift banner, handover banner) | §6 gating (UI `has()` + server-side 076 gate + RPC guards) |

## 2. Data model

```sql
companion.shifts (
  id            uuid pk default gen_random_uuid(),
  org_id        uuid not null references companion.organisations(id) on delete cascade,
  program_id    uuid not null,
  worker_id     uuid references companion.profiles(id) on delete restrict,  -- nullable: open (unassigned) shift, §9 job-board
  is_open       boolean not null default false,
  required_skills text[] not null default '{}',
  template_id   uuid references companion.shift_templates(id) on delete set null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null check (ends_at > starts_at),
  status        text not null default 'draft' check (status in ('draft','published','confirmed','in_progress','completed','cancelled')),
  notes         text,                -- coordinator note; cancellation reason lands here too
  override_note text,                -- coordinator override for a worker-overlap warning
  created_by    uuid not null references companion.profiles(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  deleted_at    timestamptz,         -- soft-delete only; never hard-delete
  constraint shifts_id_org_uk unique (id, org_id),          -- enables shift_participants composite FK
  constraint shifts_open_worker_null check (not is_open or worker_id is null),
  foreign key (program_id, org_id) references companion.programs(id, org_id) on delete cascade
)
create unique index shifts_template_starts_uk on companion.shifts(template_id, starts_at) where template_id is not null;  -- idempotent pg_cron generation
companion.shift_participants (
  shift_id       uuid not null,
  participant_id uuid not null,
  org_id         uuid not null,      -- composite FKs make cross-org rows structurally unexpressable
  left_at        timestamptz,        -- soft-remove: participant removed from a shift keeps history
  primary key (shift_id, participant_id),
  foreign key (shift_id, org_id)       references companion.shifts(id, org_id)  on delete cascade,
  foreign key (participant_id, org_id) references companion.clients(id, org_id) on delete cascade
)
companion.shift_handovers (
  id                  uuid pk default gen_random_uuid(),
  shift_id            uuid not null references companion.shifts(id) on delete cascade,
  author_id           uuid not null references companion.profiles(id) on delete restrict,
  body                text,                    -- nullable; see §3.4 "nothing to hand over"
  nothing_to_hand_over boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint handover_body_xor check ((body is null or body = '') = nothing_to_hand_over)
  -- append-only: written once by rostering_end_shift (or coordinator force-end, §9.2);
  -- no UPDATE/DELETE path ever; coordinator edits are DECISION Q-B (§9.2)
)
companion.shift_templates (
  id              uuid pk default gen_random_uuid(),
  org_id          uuid not null references companion.organisations(id) on delete cascade,
  program_id      uuid not null,
  worker_id       uuid not null references companion.profiles(id) on delete restrict,  -- v1 lite: templates always coordinator-assigned, never open
  day_of_week     int not null check (day_of_week between 0 and 6),
  starts_time     time not null,
  ends_time       time not null check (ends_time > starts_time),
  end_date        date,                        -- null = generates indefinitely
  participant_ids uuid[] not null default '{}', -- carried onto each generated shift
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  foreign key (program_id, org_id) references companion.programs(id, org_id) on delete cascade
)
companion.worker_availability (
  worker_id     uuid not null references companion.profiles(id) on delete cascade,
  org_id        uuid not null references companion.organisations(id) on delete cascade,
  day_of_week   int not null check (day_of_week between 0 and 6),
  starts_time   time not null,
  ends_time     time not null check (ends_time > starts_time),
  primary key (worker_id, day_of_week)         -- v1 lite: one window per weekday, not multiple ranges
)
companion.profile_skills (
  profile_id    uuid not null references companion.profiles(id) on delete cascade,
  org_id        uuid not null references companion.organisations(id) on delete cascade,
  skill         text not null,
  primary key (profile_id, skill)
)
```

Design notes (verified repo context):
- **Composite-FK discipline** mirrors Programs (091) and `sub_roles` (068): `org_id` on the join table plus `(id, org_id)` unique on the parent make cross-org assignment structurally unexpressable, not merely RPC-checked. `shift_templates` follows the same shape against `programs`.
- **`worker_id` is a plain FK to `profiles(id)`** (on `shifts`, `shift_templates`, `worker_availability`, `profile_skills`) — `profiles` has no `(id, org_id)` unique (Programs-design §10.2 residual risk); org match is enforced in the RPC against `program_workers(program_id, worker_id, removed_at is null, org_id)`, as Programs' RPCs do.
- **`created_by` stays NOT NULL — pinned; `worker_id` is now nullable (open/unassigned shifts, §9 job-board)**: `remove_member` (092 extends it) **refuses** removal while the member has any future *assigned* shift (`starts_at >= now()`, status not in (`cancelled`,`completed`), `worker_id` not null) as `worker_id` or `created_by`, or authored a handover on a non-completed shift — **the refusal applies to assigned rows only**; an open shift (`worker_id` null) never blocks a departure, since nobody is assigned to it. Past rows keep their references — safe because `remove_member` soft-detaches profiles (org_id → null), never hard-deletes them, and the `on delete restrict` FKs back that up. A NULL `worker_id` always means an open shift (`is_open = true`, enforced by the check constraint) — never "unknown"; no ambiguous-NULL RLS case exists.
- Indexes: `shifts(org_id, program_id, starts_at)`, `shifts(worker_id, starts_at)`, `shifts(org_id, status)`, `shifts(org_id, is_open, status) where is_open` (job-board lookups), `shift_participants(participant_id)`, `shift_handovers(shift_id, created_at desc)`, `shift_templates(org_id, program_id)`, `worker_availability(org_id)`, `profile_skills(org_id, skill)`.
- No columns beyond §3.1 + the compliance additions (`override_note`, `deleted_at`, `left_at`) and the "nothing to hand over" flag, plus the v1 additions above (`is_open`, `required_skills`, `template_id`, `shift_templates`, `worker_availability`, `profile_skills`).

## 3. Status machine

Legal transitions, enforced in RPCs (never by direct UPDATE — §4):

| From | To | Actor | Notes |
|---|---|---|---|
| draft | published | coordinator | Fires the notify step (§6.2) |
| draft | cancelled | coordinator | Cancellation reason into `notes` |
| published | confirmed | assigned worker | Records the worker's acceptance |
| published (open, worker_id null) | confirmed | any worker staffing the program | Claim: `rostering_claim_shift` assigns `worker_id` (clears `is_open`) and records the acceptance in one step; re-runs the overlap check under the advisory lock for the claiming worker |
| published | cancelled | coordinator | Worker notified |
| confirmed | cancelled | coordinator | Worker notified; prefer re-publish over cancel for the next worker's continuity |
| published, confirmed | in_progress | assigned worker | Only within the start window (§3 rules); a worker cannot start a shift they don't own |
| in_progress | completed | assigned worker | Requires a handover: `body` non-empty XOR `nothing_to_hand_over` = true; both or neither → error; DB CHECK backs it (§2) |
| in_progress | completed | coordinator | Force-end, handover required — DECISION Q-A (§9), recommended default; breaks the author-is-worker invariant, stated there |
| in_progress | cancelled | — | **Not allowed**: an in-progress shift must terminate with a handover (care continuity) |
| any | soft-deleted | coordinator | `rostering_delete_shift`: legal from draft/published/confirmed only; sets `deleted_at`, not a status |

Rules:
- **Schedule edits** (worker, times, participants) only while `draft`, via `rostering_update_shift`, which re-runs staffing + overlap validation under the advisory lock. `notes`/`override_note` are coordinator-editable at any pre-completion status. A published/confirmed shift needing a schedule change is cancelled and recreated — the roster audit trail stays honest.
- **Start window**: `rostering_start_shift` accepts from `greatest(starts_at − 2 hours, date_trunc('day', starts_at))` through `ends_at`; outside → error. The clamp means an early-morning shift (e.g. 06:00) can still be started from midnight — never "the day before".
- **Overlap rule** (§3.5): an overlap is any pair of shifts for the same worker with `starts_at < other.ends_at AND ends_at > other.starts_at`, neither status `cancelled`/`completed` nor soft-deleted. Create/update/copy-forward take `pg_advisory_xact_lock(hashtextextended(worker_id::text, 0))` **before** the overlap SELECT, so two concurrent creates for one worker cannot both pass the check (check-then-insert is otherwise racy). Failure → "shift overlaps" unless the **new** shift carries `override_note` (coordinator override, per shift).
- **Transitions are conditional UPDATEs**: every transition RPC runs `update ... set status = <to> where id = X and status = <legal from>` and treats an affected-row count of 0 as "invalid transition". No RPC ever checks-then-writes a status. Transition UPDATEs also set `updated_at = now()`.
- **`rostering_end_shift`** is the only writer of `shift_handovers`; it sets `completed` and inserts the handover row in one transaction.
- **Start without confirm is allowed** (published → in_progress directly). Consequently W3 counts **only** `published` shifts: a started shift is no longer "unconfirmed". **W3 also excludes open shifts** (`worker_id is null`) — an unclaimed shift is a job-board listing, not an unconfirmed assignment; it surfaces instead via the open-shifts count on the job board itself.

## 4. RLS / access

House style: 053's role-policy shape, 076's entitlement gate, 088's revoke pattern, 079 `my_org_id()`/`my_role()` model. Worker roster reads go through **program membership** (`program_workers`) — the same membership 089's consolidated `client_ids_for_worker()` helper gates participant access on; note 089 itself is program-unaware, the program-derived union lands with the 091/092 foundation. Shifts use program membership directly (not participant-derived access): a worker reads roster/handover for their whole program per §3.4.

All six tables (the original three plus `shift_templates`/`worker_availability`/`profile_skills`): **select-only RLS policies; no insert/update/delete policies anywhere** — every write goes through SECURITY DEFINER RPCs (§5). Explicit `revoke insert, update, delete on ... from anon, authenticated` per table (088 pattern; 060's schema default privileges would otherwise expose direct PostgREST writes), `grant select` to `authenticated`.

The worker program-staffing predicate (used in two policies) is defined once as `companion.worker_program_ids()` returning `setof uuid` (SECURITY DEFINER, org-tested), matching 089's one-predicate discipline.

| Table | Policy | Using |
|---|---|---|
| shifts | coordinators view org shifts | `org_id = public.my_org_id() and public.my_role() = 'coordinator' and deleted_at is null` |
| shifts | workers view own shifts | `worker_id = auth.uid() and deleted_at is null and status in ('published','confirmed','in_progress','completed')` — own shifts only; **draft and cancelled are never worker-visible**; the program roster is not open to workers |
| shifts | workers view the open-shifts job board | `is_open and status = 'published' and deleted_at is null and program_id in (select companion.worker_program_ids())` — unassigned shifts in any program the worker staffs; separate from "own shifts" since `worker_id` is null here |
| shift_participants | coordinator view | `org_id = public.my_org_id() and public.my_role() = 'coordinator'` |
| shift_participants | worker view | `left_at is null and exists (select 1 from companion.shifts s where s.id = shift_participants.shift_id and s.worker_id = auth.uid() and s.deleted_at is null and s.status in ('published','confirmed','in_progress','completed'))` — participants of own shifts only |
| shift_handovers | coordinator view | `public.my_role() = 'coordinator' and shift_id in (select id from companion.shifts where org_id = public.my_org_id() and deleted_at is null)` |
| shift_handovers | worker view | `shift_id in (select id from companion.shifts where deleted_at is null and (worker_id = auth.uid() or <worker program-staffing predicate>))` — **program scope is deliberate**: §3.4 requires the next worker to read the previous shift's handover for the same program before logging |
| shift_templates | coordinator org view | `org_id = public.my_org_id() and public.my_role() = 'coordinator'` — no worker read policy; workers never see templates directly, only the shifts they generate. All writes (create/update/pause/delete) go through RPCs (§5.1), consistent with "no insert/update/delete policies anywhere" above |
| worker_availability | worker own | `worker_id = auth.uid()` |
| worker_availability | coordinator org read | `org_id = public.my_org_id() and public.my_role() = 'coordinator'` |
| profile_skills | worker own | `profile_id = auth.uid()` |
| profile_skills | coordinator org read | `org_id = public.my_org_id() and public.my_role() = 'coordinator'` |
| all six | entitlement gate | 076-style restrictive `for all to authenticated` policy `using ((select public.org_has_feature('rostering'))) with check (...)` — §6.1; denies every row (on all six tables, including the three v1 additions) to orgs without the key, closing the direct-API bypass |

- **Family, recipient, therapist, decision_maker: no access — deliberate** (provider-internal operations; the §6.3 digest exclusion is enforced here and structurally).
- `deleted_at is null` on every read path; a soft-deleted shift (and its handovers, via the shifts subquery) disappears from all surfaces but its rows and revisions persist for audit.

## 5. Surface APIs

### 5.1 RPCs (companion schema, SECURITY DEFINER, `set search_path = 'companion','public'`, org via `public.my_org_id()`, actor via `public.my_role()`)

Every RPC begins with the server-side gate `if not public.org_has_feature('rostering') then raise ...` (074's fail-closed idiom) — SECURITY DEFINER bypasses RLS, so the guard is the only thing stopping a downgraded org's direct RPC calls.

| RPC | Actor | Purpose / notes |
|---|---|---|
| `rostering_create_shift(program_id, worker_id, starts_at, ends_at, participant_ids uuid[], notes, override_note)` | coordinator | Gate; advisory lock on worker_id; validates worker staffs the program (removed_at null, org match) and participants are in the program; overlap check (§3); inserts shift + participants in one tx |
| `rostering_update_shift(shift_id, worker_id, starts_at, ends_at, participant_ids, notes, override_note)` | coordinator | Draft-only schedule edits re-running staffing + overlap under the same lock; notes/override_note editable at any pre-completion status |
| `rostering_delete_shift(shift_id)` | coordinator | Soft-delete (sets `deleted_at`), legal from draft/published/confirmed; in_progress/completed shifts are never deleted (history); no notify |
| `rostering_publish_shift(shift_id)` | coordinator | Conditional UPDATE draft→published; fires the notify step (§6.2) |
| `rostering_cancel_shift(shift_id, reason)` | coordinator | Conditional UPDATE draft/published/confirmed→cancelled; reason into `notes`; notifies the worker if the shift was published+ |
| `rostering_confirm_shift(shift_id)` | assigned worker | Conditional UPDATE published→confirmed |
| `rostering_claim_shift(shift_id)` | any worker staffing the program | Gate; requires `is_open` + `status = 'published'`; advisory lock on the claiming worker; re-runs the overlap check (§3); conditional UPDATE sets `worker_id`, clears `is_open`, moves straight to `confirmed` |
| `rostering_start_shift(shift_id)` | assigned worker | Conditional UPDATE published/confirmed→in_progress; start-window check (§3) |
| `rostering_end_shift(shift_id, handover_body, nothing_to_hand_over)` | assigned worker (or coordinator force-end, §9) | Conditional UPDATE in_progress→completed; writes the handover row in the same tx; XOR validation |
| `rostering_copy_forward(source_week date, target_week date)` | coordinator | Copies draft/published/confirmed shifts of source week to target week as draft, dates +7d; advisory lock per copied worker; **skips** shifts whose worker no longer staffs the program and **skips (does not abort)** shifts conflicting with an existing target-week shift; returns created/skipped counts |
| `rostering_week_grid(week_start date, program_id)` | coordinator | Shifts of that week × program joined with worker + participant names, bucketed day × worker. **Bucketing rule**: a shift belongs to the UTC day of its `starts_at`; W2 uses the same rule |
| `rostering_warnings(week_start date, program_id)` | coordinator | W1: worker-overlap pairs; W2: program participants with no shift cover that day (same UTC-day rule; a shift with no participants covers no one); W3: **published-only** shifts that week not yet confirmed |
| `rostering_previous_handover(program_id, participant_ids uuid[], before timestamptz)` | assigned worker | Most recent handover on a completed shift of the same program sharing ≥1 participant, `starts_at < before`; fallback: most recent same-program handover when none shares participants — the banner labels the fallback "no shared participants". SECURITY DEFINER (unaffected by the narrowed worker select policy) |
| `rostering_set_availability(days jsonb)` | worker (own) | Replace-all: deletes the worker's existing `worker_availability` rows and inserts the supplied set in one tx; `days` is an array of `{day_of_week, starts_time, ends_time}` |
| `rostering_set_skills(skills text[])` | worker (own) | Replace-all: deletes the worker's existing `profile_skills` rows and inserts the supplied list in one tx |
| `rostering_create_template(program_id, worker_id, day_of_week, starts_time, ends_time, end_date, participant_ids)` | coordinator | Gate; validates worker staffs the program (as `rostering_create_shift`); inserts the template row |
| `rostering_update_template(template_id, ...)` | coordinator | Same validation as create; updates the template row (schedule fields only — does not touch already-generated shifts) |
| `rostering_pause_template(template_id, active boolean)` | coordinator | Toggles `active`; a paused template stops generating new shifts but existing generated shifts are untouched |
| `rostering_delete_template(template_id)` | coordinator | Hard-delete of the template row; `shifts.template_id` on already-generated shifts is set null (`on delete set null`) — the shifts themselves are never touched |

Generation: `companion.fn_generate_shift_templates()` — SECURITY DEFINER, granted to `postgres`, called by `pg_cron` (085 idempotent-schedule pattern: `select cron.unschedule(...) where exists (select 1 from cron.job where jobname = 'companion_generate_shifts')` before `cron.schedule('companion_generate_shifts', ...)`). For each active template with `end_date` null or in the future, inserts the next occurrence's `shifts` row as `draft`, carrying `template_id`, `program_id`, `worker_id`, `participant_ids`; the `shifts_template_starts_uk` unique index (§2) makes a re-run idempotent (`on conflict do nothing`) rather than double-generating.

Note: the week-summary panel (§5.3) is **client-side only**, computed from the existing `rostering_week_grid` result — no new RPC.

"Assigned worker" = `auth.uid() = shifts.worker_id`; every RPC returns `{ok, error?}`-shaped errors and raises a single labelled exception the client maps to a message.

### 5.2 Edge function change: `push-notify` gains a `shift` branch
Single-file, additive. On `type: 'shift'` target `push_subscriptions` where `user_id = record.worker_id` for the shift's org, excluding `record.created_by`. **The payload must carry `worker_id`** — the function's current record type (org_id/client_id/sender_id/author_id/user_id) has no field for it; the trigger passes the full NEW row via `row_to_json(NEW)`, which includes it. Do NOT copy the function's `message` branch: it targets org-minus-sender, the wrong audience for a shift notice.

### 5.3 Coordinator surfaces (§3.2)
- `/rostering` route (RequireFeature `rostering`): program selector → week grid (days × workers, shift blocks from `rostering_week_grid`); create-shift modal (program-assigned workers only, participant multi-pick filtered to the program, conflict shown before save, override gated on a reason, **availability hint** — greys out / flags workers outside their `worker_availability` window for the shift's day, non-blocking, **skills-match flag** — flags workers whose `profile_skills` don't cover the shift's `required_skills`, non-blocking); copy-forward; warnings panel (three kinds colour-coded); cancel/publish/delete on shift blocks; a shift block's detail view lists its handovers **read-only** (the §3.4 "visible to coordinators" read surface; editing is DECISION Q-B, §9).
- **Week-summary panel**: per-worker hours/shift-count/unconfirmed-count for the displayed week, computed **client-side** from the `rostering_week_grid` result already fetched for the grid (§5.1) — no new RPC, no new query.
- **Drag-and-drop** on the grid: dragging a `draft` shift to a new worker/day calls `rostering_update_shift` directly (schedule edits are draft-only, §3). Dragging a `published`/`confirmed` shift runs the cancel-and-recreate flow instead (§3 restricts schedule edits on non-draft shifts to that path) — the UI performs both calls and surfaces one combined result.
- **Template management**: "create template from this shift" on a shift block's detail view (pre-fills day/time/worker/participants from that shift); a template list view (program-scoped) with pause/resume and delete actions calling the template RPCs (§5.1).
- Realtime: `postgres_changes` on `companion.shifts` (org filter) so the grid updates without polling — the MessagesHub pattern.
- Deferred (one line, out of §3 scope): §11's provider-dashboard "Roster entry point" reuses `rostering_warnings`/`rostering_week_grid`; designed in the dashboard slice, not here.

### 5.4 Worker surfaces (§3.3) — all gated `has(FEATURES.rostering)` (§6.1)
- "My shifts" list: direct select via the §4 worker policy (own shifts only: upcoming published/confirmed, program, time, participants). Confirm / Start / End-shift call the matching RPCs; end-shift opens the handover form (note or explicit "nothing to hand over").
- **Open-shifts job board**: direct select via the §4 job-board policy (unassigned `published` shifts in any staffed program). Browse list + a "claim" action calling `rostering_claim_shift` (§5.1); a claimed shift moves off the board and into "My shifts".
- **Availability editor**: a weekly grid (day × time window) reading/writing via `rostering_set_availability` (replace-all, §5.1).
- Worker home: shows today's not-yet-started published/confirmed shift **with a Start button** (the §3.3 "appears on the home → start" flow) or, once started, the active-shift card (today's `in_progress` shift). No shift → no card. Unchanged by the v1 additions above.
- Previous-handover banner (§3.4) renders from `rostering_previous_handover` before the first log entry of the shift; fallback labelled "no shared participants" (§5.1).

### 5.5 On-shift display (§3.5 first assertion)
"On shift · HH:MM–HH:MM" is **derived from the `shifts` row** (starts_at/ends_at of the worker's current `in_progress` shift). Verified: no "On shift" string exists in `src/` today, so there is no hardcoded display to replace; if no `in_progress` shift exists, no banner renders.

## 6. Entitlement gating

### 6.1 The `rostering` key — UI and server-side
Verified absent today from `mab-features.json` (14 keys; +`rostering` = 15 after this build) and `FEATURES` in `src/lib/features.ts`. The build adds `{ "key": "rostering", "name": "Rostering & shift handover" }` to `mab-features.json` and `rostering: 'rostering'` to `FEATURES`. `deploy.yml` already POSTs the manifest to the hub on every master push (verified) — idempotent, so the key is auto-created but starts **included in no plan**; David ticks it onto Team/Enterprise in MAB Admin (plan assignment is hub-side; Haven precedent). Until then every `has('rostering')` is false — the fail-closed direction.

Gating is **two layers**, because fail-closed UI alone leaves the API open (076's lesson):
1. **UI**: every rostering surface — the coordinator `/rostering` route (RequireFeature wrapper, `App.tsx:114` pattern) AND every worker surface named in §5.4 — renders conditionally on `useFeatures().has(FEATURES.rostering)`; the hook returns an empty Set while loading/on error, so "absent" is the default state.
2. **Server**: 076-style restrictive `for all` RLS policies on all three tables (§4) and the first-line `org_has_feature('rostering')` guard in every RPC (§5.1) — a downgraded org reads and writes nothing, even by direct API call. The DB storage layer itself is not gated (Programs precedent: migrations create storage + access rules; the key gates use).

### 6.2 Notify step (§3.2 "Publish notifies the assigned workers")
Real mechanisms verified in this repo: (a) `push_subscriptions` + the `push-notify` edge function, fired by DB triggers via `net.http_post` (017/019 pattern; Vault key per 037); (b) realtime `postgres_changes` subscriptions (MessagesHub/WorkerMessages pattern); (c) `messages`/`notices` tables — **ruled out on real grounds**: `messages.client_id` has been nullable since 015 and since 057 `messages` is threaded 1:1 org messaging keyed on `recipient_id` (a conversation, not a notice), and `push-notify`'s message branch targets org-minus-sender — the wrong audience for a shift notice.

Design: publish/cancel fire an `after update on companion.shifts` trigger (`notify_push_on_shift_publish`) POSTing `{record, type: 'shift'}` with **a WHEN clause** — `when (old.status = 'draft' and new.status = 'published') or (old.status in ('published','confirmed') and new.status = 'cancelled')` — so note-edits on published shifts never re-notify. The `shift` branch targets the worker's subscriptions via `record.worker_id` (§5.2). In-app delivery is the worker's own realtime subscription on `shifts`. Marked provisional-open (§9) — droppable without schema change.

### 6.3 Family digest exclusion (§3.4)
Verified: the family digest is `FamilyDashboard.tsx`, which queries `log_entries` (with the retention cutoff) plus `notices` and `log_entry_photos` for the client, and only client/family/author identity lookups (`clients`, `client_family`, `profiles`) — no other content tables. `shift_handovers` is a separate table those queries never touch, and §4 grants family **no** RLS select. The exclusion is therefore structural + policy, not a filter that can rot. Assertion to preserve: never UNION handovers into the digest queries; a future "handover in digest" feature is an explicit opt-in, not a join. The "previous handover" banner appears on the worker shift home only — before the first log entry screen of the shift, per §4.1 of the team-mode spec.

## 7. Audit & retention

- **Revisions**: attach `companion.fn_record_revision` (084) as `before update` triggers on `companion.shifts` **only** — handovers stay append-only (no UPDATE path exists; a trigger there would be dead code), and **`shift_templates`/`worker_availability`/`profile_skills` are config/settings tables, not care-record history — no revision trigger on any of the three** (stated explicitly; do not extend the trigger set to them). Extend the 084 `record_revisions.table_name` check to include `'shifts'` (idempotent `drop constraint if exists record_revisions_table_name_check` + re-add).
- **`record_org_id` fix**: 084's select policy resolves visibility through the editor's CURRENT `profile_orgs` membership, so a departed worker's revisions vanish from the org audit view. Rostering migration 093 fixes this org-wide: add `record_org_id uuid` to `companion.record_revisions`, extend `fn_record_revision` to write `old.org_id` (every audited table has NOT NULL `org_id` — verified: log_entries, behaviour_notes, incidents, medication_logs, restrictive_practices, behaviour_support_plans), and recreate the select policy as `record_org_id = public.my_org_id() or <editor-membership predicate>` (idempotent drop/recreate). Revisions stay visible to the org that owns the row regardless of who later departs.
- **Soft-delete only**: `deleted_at` on shifts, `left_at` (soft-remove) on shift_participants; no DELETE policy and no DELETE grant on any rostering table (§4). Handover rows are append-only — no UPDATE/DELETE grant exists at all, not even for coordinators.
- **"~7 years" pinned**: the 085 retention cron touches `log_entries` only (verified) — revisions and handovers have **no purge mechanism**, so the NDIS ~7-year horizon is met by construction, not by a timer. §8.3 verifies this against a test org.
- **`remove_member`** (092 extends it — the program-cleanup fix lives in the proposal's RPCs file, **not** 091) must add the rostering refusal of §2 before detaching a member.

## 8. Migration plan (finalized 2026-08-30) + verification

| # | File | Contents |
|---|---|---|
| 091 | programs infrastructure | **Not this task** — Task 6 foundation (programs, program_participants, program_workers, `clients(id, org_id)` unique, helper union) |
| 092 | programs RPCs | **Not this task** — Task 6 foundation (incl. `remove_member` program-cleanup fix) |
| 093 | `093_rostering_infrastructure` | Six tables (§2: shifts, shift_participants, shift_handovers, shift_templates, worker_availability, profile_skills), indexes, `unique (id, org_id)`, handover XOR check, `shifts_open_worker_null` check, `shifts_template_starts_uk` unique index, RLS policies (incl. job-board policy) + 076-style entitlement gate on all six (§4), revoke/grants, `worker_program_ids()` helper, record_revisions `table_name` check extension + `record_org_id` fix + revision triggers on shifts only (§7) |
| 094 | `094_rostering_rpcs` | Twelve original RPCs (§5.1) plus `rostering_claim_shift`, `rostering_set_availability`, `rostering_set_skills`, and the four template CRUD RPCs — each with the `org_has_feature` first-line guard, advisory-lock overlap, conditional-UPDATE transitions |
| 095 | `095_rostering_notify` | `notify_push_on_shift_publish` trigger with WHEN clauses (§6.2) |

All idempotent (`if not exists` / `drop ... if exists`), SQL schema-qualified `companion.`. Numbering is concrete (2026-08-30 decision, Option 1 sequencing — Programs slice first): 093–095 are the next free numbers after the Programs foundation lands as 091/092. Non-migration changes ship with the UI slice: `mab-features.json`, `src/lib/features.ts`, the `push-notify` branch, and the routes/surfaces.

Verification (per 076/084 practice — run on freshly-created test orgs):
- **8.1 Structural**: `pg_policies` shows the three permissive worker/coordinator policies + the restrictive gate per table; `revoke` state confirmed (`has_table_privilege` false for anon on insert/update/delete); `worker_program_ids()` is SECURITY DEFINER with the org test.
- **8.2 Behavioural**: with `rostering` absent from the org's mirrored entitlements, a worker role receives zero rows from every rostering table via PostgREST and every RPC raises the gate error; with the key ticked in MAB Admin (mirror syncs), the same calls succeed; family/recipient/therapist see zero rows in all three tables; worker sees only own shifts in the narrowed status set; overlap create without override fails, with override succeeds; concurrent creates for one worker cannot both land (advisory lock).
- **8.3 Retention**: run the retention-purge cycle against the test org; assert `shift_handovers` and `record_revisions` rows survive (085's cron must not grow to touch them).

## 9. Open questions / decisions for David (bracketed default — no reply means accept)

**DECISION Q-A (was Q2) — abandoned in_progress shift.** Only the assigned worker can end a shift; a started-but-abandoned shift otherwise never terminates, no handover is ever written, and the previous-handover chain silently drops that segment. Two options:
1. **Coordinator force-end (recommended)**: a coordinator can run `rostering_end_shift` on an in_progress shift, supplying the handover note themselves. Explicitly breaks the author-is-worker invariant (`shift_handovers.author_id` is normally the assigned worker; force-end writes the coordinator's id) — accepted for care continuity; the revision trail records the difference via the shifts trigger.
2. **Coordinator transfer**: transfer the in_progress shift to another worker, who then ends it with their own handover. Preserves the invariant; adds a transfer RPC + the receiving worker's cooperation.

Either way, pinned: **every in_progress shift terminates with a handover** (care continuity). [Option 1]

**DECISION Q-B — coordinator correction of handover bodies.** Handovers are append-only by design (§7); a genuine error in a handover is currently uncorrectable. Options: (a) stay append-only (**[recommended default]** — the audit record is the record; errors are flagged in the next shift's handover instead); or (b) allow coordinators to edit handover bodies, which re-attaches the 084 revision trigger to `shift_handovers` (then not dead code) and trails the edit for ~7 years. [a]

1. **Push notification for publish/cancel** — extend `push-notify` with a `shift` branch + trigger (§6.2)? [Yes — the only server-side notify mechanism matching §3.2 "notifies"; droppable without schema change, leaving in-app realtime only]
2. **Copy-forward scope** — [copies draft/published/confirmed shifts of the source week, skipping cancelled/completed; all land as `draft`; participants carried; skips (not aborts) conflicts and workers who no longer staff the program; returns created/skipped counts]
3. **Week-grid day bucketing timezone** — [UTC day of `starts_at` (pinned, §5.1); `org_settings` has no timezone column (verified), only `locale` defaulting to en-AU. Org-local bucketing is deferred until org_settings gains a tz column]

**Deferred out of v1 (David, 2026-08-30)** — 8 capabilities considered and explicitly pushed out, one-line rationale each:
1. **Labour cost rows** — no wage/rate data model exists anywhere in Companion yet; belongs with a payroll feature, not the roster grid.
2. **Timesheet/payroll export** — owned by the separate TIME SHEETING session/feature; building it here would duplicate that scope.
3. **Shift swaps (worker-to-worker)** — needs its own request/approval workflow distinct from claiming; v1 ships coordinator-created open shifts + claim only, not peer-to-peer handoff.
4. **GPS clock-in** — no location-capture infrastructure or consent/privacy design exists in this app; a compliance question of its own.
5. **SCHADS award & fatigue warnings** — award interpretation (rates, breaks, fatigue rules) is a compliance project of its own, not a v1 roster warning.
6. **NDIS plan-linked shifts** — would require joining shifts to plan line-items/budgets, which no part of the current data model models.
7. **AI auto-scheduling** — depends on the manual grid, availability, and skills data existing and being trusted first; a v2 layer built on top of v1, not part of it.
8. **Time-off/leave integration** — no leave/unavailability-request table exists; v1's `worker_availability` covers recurring weekly windows only, not one-off leave requests.

**Sequencing (2026-08-30)**: Programs slice first — minimal Programs slice (091/092) lands before rostering (093–095).
