# Companion — Rostering design (design spec)

Status: ready for build. Grounding: `Companion-Team-Mode-Spec.md` §3 (Rostering & shift handover,
`rostering` — Team+). Dependency: Programs foundation (090/091, per `2026-08-24-programs-reslice-proposal.md`
decision Option B). Entitlement: `rostering` — NEW key, declared when this is built. This doc is
spec-first: migrations/RPCs are designed in prose; implementation numbers are provisional (§8).

## 1. Requirements trace

| §3 | Requirement | Where designed |
|---|---|---|
| 3.1 | `shifts` / `shift_participants` / `shift_handovers` model | §2 |
| 3.2 | Week-grid roster view per program | §5 `rostering_week_grid` |
| 3.2 | Create shift (program, worker, time, participants); only program-assigned workers selectable | §5 create RPC |
| 3.2 | Publish notifies the assigned worker | §3, §6.2 |
| 3.2 | Three warnings: worker overlap, participant with no cover, published-unconfirmed | §5 `rostering_warnings` |
| 3.2 | Copy-forward last week's roster | §5 `rostering_copy_forward` |
| 3.3 | My shifts; confirm; start; end | §5 RPCs, §3 |
| 3.4 | Previous handover shown before logging begins | §5 `rostering_previous_handover` |
| 3.4 | Handover part of participant record, coordinator-visible, NOT in family digest | §4, §7, §6.3 |
| 3.5 | "On shift" display derived from a `shifts` row, never hardcoded | §5.5 |
| 3.5 | Worker cannot be rostered to a program they do not staff | §5 create RPC |
| 3.5 | Publish notifies; confirm records `confirmed` | §3, §6.2 |
| 3.5 | End requires handover note or explicit "nothing to hand over" | §3, §5 `rostering_end_shift` |
| 3.5 | Next worker sees previous handover before first log entry | §5 `rostering_previous_handover` |
| 3.5 | Overlap warning raised, blocked unless coordinator overrides | §3, §5 (`override_note`) |
| 3.5 | All rostering surfaces absent when `rostering` is off | §6 gating |

## 2. Data model

```sql
companion.shifts (
  id            uuid pk default gen_random_uuid(),
  org_id        uuid not null references companion.organisations(id) on delete cascade,
  program_id    uuid not null,
  worker_id     uuid not null references companion.profiles(id) on delete restrict,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null check (ends_at > starts_at),
  status        text not null default 'draft'
                check (status in ('draft','published','confirmed','in_progress','completed','cancelled')),
  notes         text,                -- coordinator note; cancellation reason lands here too
  override_note text,                -- coordinator override for a worker-overlap warning
  created_by    uuid not null references companion.profiles(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  deleted_at    timestamptz,         -- soft-delete only; never hard-delete
  constraint shifts_id_org_uk unique (id, org_id),          -- enables shift_participants composite FK
  foreign key (program_id, org_id) references companion.programs(id, org_id) on delete cascade
)

companion.shift_participants (
  shift_id       uuid not null,
  participant_id uuid not null,
  org_id         uuid not null,      -- composite FKs make cross-org rows structurally unexpressable
  left_at        timestamptz,        -- soft-delete: a participant removed from a shift keeps history
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
  created_at          timestamptz not null default now()
  -- append-only: written once by rostering_end_shift, never updated, never deleted
)
```

Design notes (verified repo context):
- **Composite-FK discipline** mirrors Programs (090) and `sub_roles` (068): `org_id` on the join
  table plus `(id, org_id)` unique on the parent make cross-org assignment structurally
  unexpressable, not merely RPC-checked.
- **`worker_id` is a plain FK to `profiles(id)`** — `profiles` has no `(id, org_id)` unique
  (Programs-design §10.2 residual risk); org match is enforced in the RPC against
  `program_workers(program_id, worker_id, removed_at is null, org_id)`, as Programs' RPCs do.
- **`worker_id` FK is `on delete restrict`**; member removal flows through `remove_member` (090
  extends it for programs; rostering cleanup there — §9.7).
- Indexes: `shifts(org_id, program_id, starts_at)`, `shifts(worker_id, starts_at)`,
  `shifts(org_id, status)`, `shift_participants(participant_id)` (no-cover warning + handover
  lookup), `shift_handovers(shift_id, created_at desc)`.
- No columns beyond §3.1 + the two compliance additions (`override_note`, `deleted_at`) and the
  "nothing to hand over" flag on handovers.

## 3. Status machine

Legal transitions, enforced in RPCs (never by direct UPDATE — §4):

| From | To | Actor | Notes |
|---|---|---|---|
| draft | published | coordinator | Fires the notify step (§6.2) |
| draft | cancelled | coordinator | Cancellation reason into `notes` |
| published | confirmed | assigned worker | Records the worker's acceptance |
| published | cancelled | coordinator | Worker notified |
| confirmed | cancelled | coordinator | Worker notified; prefer re-publish over cancel for the next worker's continuity |
| published, confirmed | in_progress | assigned worker | Only within the start window (§9.3); a worker cannot start a shift they don't own |
| in_progress | completed | assigned worker | Requires a handover: `body` non-empty XOR `nothing_to_hand_over` = true; both or neither → error (§3.4, §3.5) |
| in_progress | cancelled | — | **Not allowed** (§9.2): an in-progress shift must end with a handover to preserve care continuity |

Rules:
- **Schedule edits** (worker, times, participants) only while `draft`. `notes`/`override_note` are
  coordinator-editable at any pre-completion status. A published/confirmed shift needing a schedule
  change is cancelled and recreated — the roster audit trail stays honest.
- **Overlap rule** (§3.5): an overlap is any pair of shifts for the same worker with
  `starts_at < other.ends_at AND ends_at > other.starts_at`, neither status `cancelled`/`completed`.
  Create/update fails with "shift overlaps" unless the **new** shift carries `override_note`
  (coordinator override, per shift).
- **`rostering_end_shift`** is the only writer of `shift_handovers`; it sets `completed` and inserts
  the handover row in one transaction.

## 4. RLS / access

House style: 053's role-policy shape, 088's revoke pattern, 079 `my_org_id()`/`my_role()` model,
worker access through `program_workers` membership (as consolidated in 089's
`client_ids_for_worker()` — but shifts use **program** membership directly, not participant-derived
access, because a worker reads roster/handover for their whole program).

All three tables: **select-only RLS policies; no insert/update/delete policies anywhere** — every
write goes through SECURITY DEFINER RPCs (§5). Explicit `revoke insert, update, delete on ... from
anon, authenticated` per table (088 pattern; 060's schema default privileges would otherwise expose
direct PostgREST writes), `grant select` to `authenticated`.

| Table | Policy | Using |
|---|---|---|
| shifts | coordinators view org shifts | `org_id = public.my_org_id() and public.my_role() = 'coordinator' and deleted_at is null` |
| shifts | workers view own shifts | `worker_id = auth.uid() and deleted_at is null` |
| shifts | workers view program shifts | `exists (select 1 from companion.program_workers pw where pw.program_id = shifts.program_id and pw.worker_id = auth.uid() and pw.removed_at is null and pw.org_id = public.my_org_id()) and deleted_at is null` |
| shift_participants | coordinator view | `org_id = public.my_org_id() and public.my_role() = 'coordinator'` |
| shift_participants | worker view | `exists (select 1 from companion.shifts s where s.id = shift_participants.shift_id and (s.worker_id = auth.uid() or <worker program-staffing predicate above>))` |
| shift_handovers | coordinator view | `shift_id in (select id from companion.shifts where org_id = public.my_org_id())` |
| shift_handovers | worker view | `shift_id in (select id from companion.shifts where worker_id = auth.uid() or <worker program-staffing predicate>)` |

- **Family, recipient, therapist, decision_maker: no access — deliberate.** Rostering is provider
  internal operations; the family digest exclusion (§6.3) is enforced here and structurally.
- Worker program-staffing predicate is the same three-line subquery in three policies — define it
  once as a helper (`companion.worker_program_ids()` returning `setof uuid`, SECURITY DEFINER,
  org-tested) and reference it, matching 089's one-predicate discipline.
- `deleted_at is null` on every worker/coordinator read; a soft-deleted shift disappears from all
  surfaces but its rows and revisions persist for audit.

## 5. Surface APIs

### 5.1 RPCs (companion schema, SECURITY DEFINER, `set search_path = 'companion','public'`, org
checked via `public.my_org_id()`, actor checked via `public.my_role()`)

| RPC | Actor | Purpose / notes |
|---|---|---|
| `rostering_create_shift(program_id, worker_id, starts_at, ends_at, participant_ids uuid[], notes, override_note)` | coordinator | Validates: worker staffs the program (`program_workers`, removed_at null, org match); participants are in the program; no overlap (§3); inserts shift + participants in one tx |
| `rostering_update_shift(shift_id, notes, override_note)` | coordinator | Note-level edits at any pre-completion status (§3) |
| `rostering_publish_shift(shift_id)` | coordinator | draft→published; fires the notify step (§6.2) |
| `rostering_cancel_shift(shift_id, reason)` | coordinator | draft/published/confirmed→cancelled; reason into `notes`; notifies the worker if the shift was published+ |
| `rostering_confirm_shift(shift_id)` | assigned worker | published→confirmed |
| `rostering_start_shift(shift_id)` | assigned worker | published/confirmed→in_progress; start-window check (§9.3) |
| `rostering_end_shift(shift_id, handover_body, nothing_to_hand_over)` | assigned worker | in_progress→completed; writes the handover row; XOR validation (§3.4) |
| `rostering_copy_forward(source_week date, target_week date)` | coordinator | Copies non-cancelled/completed shifts of source week to target week as draft (§9.4); overlap-checked; returns created count |
| `rostering_week_grid(week_start date, program_id)` | coordinator | Shifts of that week × program joined with worker + participant names, bucketed day × worker for the grid |
| `rostering_warnings(week_start date, program_id)` | coordinator | W1: worker-overlap pairs; W2: program participants with no shift cover that day; W3: published-unconfirmed shifts that week |
| `rostering_previous_handover(program_id, participant_ids uuid[], before timestamptz)` | assigned worker | Most recent handover on a completed shift of the same program sharing ≥1 participant, with `starts_at < before` (§9.5) |

"Assigned worker" = `auth.uid() = shifts.worker_id`; every RPC returns `{ok, error?}`-shaped errors
and raises a single labelled exception the client maps to a message.

### 5.2 Edge function change: `push-notify` gains a `shift` branch
Single-file, additive. On `type: 'shift'` target the assigned worker's `push_subscriptions` for the
shift's org, excluding the author — the same targeting logic the function's existing `entry` branch
uses (family) and `message` branch uses (org minus sender). See §6.2 for the trigger that calls it.

### 5.3 Coordinator surfaces (§3.2)
- `/rostering` route (RequireFeature `rostering`): program selector → week grid (days × workers,
  shift blocks from `rostering_week_grid`); create-shift modal (program-assigned workers only,
  participant multi-pick filtered to the program, conflict shown before save, override gated on a
  reason); copy-forward; warnings panel (three kinds colour-coded); cancel/publish on shift blocks.
- Realtime: `postgres_changes` on `companion.shifts` (org filter) so the grid updates without
  polling — the MessagesHub pattern.

### 5.4 Worker surfaces (§3.3)
- "My shifts" list: direct select via the §4 worker policy (upcoming, program, time, participants).
- Confirm / Start / End-shift call the matching RPCs; end-shift opens the handover form (note or
  explicit "nothing to hand over"). Worker home shows the active shift card = today's `in_progress`
  shift.

### 5.5 On-shift display (§3.5 first assertion)
"On shift · HH:MM–HH:MM" is **derived from the `shifts` row** (starts_at/ends_at of the worker's
current `in_progress` shift). Verified: no "On shift" string exists in `src/` today, so there is no
hardcoded display to replace; if no `in_progress` shift exists, no banner renders.

## 6. Entitlement gating

### 6.1 The `rostering` key
Verified absent today from `mab-features.json` (14 keys) and `FEATURES` in `src/lib/features.ts`.
The build adds: `{ "key": "rostering", "name": "Rostering & shift handover" }` to
`mab-features.json`, and `rostering: 'rostering'` to `FEATURES`. `deploy.yml` already POSTs the
manifest to the hub on every master push (verified) — idempotent, so the new key is created
automatically but starts **included in no plan**; David ticks it onto Team/Enterprise in MAB Admin
(plan assignment is hub-side; Haven precedent). Until then every `has('rostering')` is false —
which is the fail-closed direction.

### 6.2 Notify step (§3.2 "Publish notifies the assigned workers")
Real mechanisms verified in this repo: (a) `push_subscriptions` + the `push-notify` edge function,
fired by DB triggers via `net.http_post` (017/019 pattern; Vault key per 037); (b) realtime
`postgres_changes` subscriptions (MessagesHub/WorkerMessages pattern); (c) `messages`/`notices`
tables — **ruled out**: both require NOT NULL `client_id` (participant-scoped rows), wrong semantics
for a shift notice.
Design: publish/cancel fire an `after update on companion.shifts` trigger
(`notify_push_on_shift_publish`) POSTing to `push-notify` with `{record, type: 'shift'}`; the new
`shift` branch targets the worker's subscriptions (§5.2). In-app delivery is the worker's own
realtime subscription on `shifts`. Marked provisional-open (§9.1) — droppable without schema change.

### 6.3 Family digest exclusion (§3.4)
Verified: the family digest is `FamilyDashboard.tsx`, which queries `log_entries` (with the
retention cutoff) plus `notices` and `log_entry_photos` for the client — nothing else.
`shift_handovers` is a separate table those queries never touch, and §4 grants family **no** RLS
select. The exclusion is therefore structural + policy, not a filter that can rot. Assertion to
preserve: never UNION handovers into the digest queries; a future "handover in digest" feature is an
explicit opt-in, not a join.
The "previous handover" banner (§3.4) appears on the worker shift home only — before the first log
entry screen of the shift, per §4.1 of the team-mode spec.

## 7. Audit & retention

- **Revisions**: attach `companion.fn_record_revision` (084) as `before update` triggers on
  `companion.shifts` and `companion.shift_handovers`; extend the 084 `record_revisions.table_name`
  check to include `'shifts','shift_handovers'` (idempotent `drop constraint if exists
  record_revisions_table_name_check` + re-add). Every schedule change, override, cancellation and
  handover edit trails for ~7 years (never purged — the 085 retention cron touches `log_entries`
  only, verified).
- **Soft-delete only**: `deleted_at` on shifts and shift_participants; no DELETE policy and no
  DELETE grant on any rostering table (§4). Handover rows are append-only — no UPDATE/DELETE grant
  exists at all, not even for coordinators.
- **`remove_member`** (090 extends it for programs) must also handle rostering references when a
  member is removed — §9.7.

## 8. Migration plan (numbers provisional)

| # | File | Contents |
|---|---|---|
| 090 | programs infrastructure | **Not this task** — Task 6 foundation (programs, program_participants, program_workers, `clients(id, org_id)` unique, helper union) |
| 091 | programs RPCs | **Not this task** — Task 6 foundation |
| 092 | `092_rostering_infrastructure` | Three tables (§2), indexes, `unique (id, org_id)`, RLS policies (§4), revoke/grants, `worker_program_ids()` helper, record_revisions check extension + revision triggers (§7) |
| 093 | `093_rostering_rpcs` | Eleven RPCs (§5.1) |
| 094 | `094_rostering_notify` | `notify_push_on_shift_publish` trigger (§6.2) |

All idempotent (`if not exists` / `drop ... if exists`), SQL schema-qualified `companion.`.
**Numbering is provisional**: 092–094 are the next free numbers only if the foundation lands as
090/091; if the controller renumbers the foundation, rostering follows. Non-migration changes ship
with the UI slice: `mab-features.json`, `src/lib/features.ts`, the `push-notify` branch, and the
routes/surfaces.

## 9. Open questions (bracketed default — no reply means accept)

1. **Push notification for publish/cancel** — extend `push-notify` with a `shift` branch + trigger
   (§6.2)? [Yes — it is the only server-side notify mechanism that matches §3.2 "notifies";
   droppable without schema change, leaving in-app realtime only]
2. **Cancelling an in_progress shift** — [Not allowed; the shift must end with a handover (care
   continuity). A coordinator needing a worker relieved cancels the remaining future shifts, not the
   active one]
3. **Start window for `rostering_start_shift`** — [from `starts_at − 2h` through `ends_at`;
   outside → error. Window exists so an early-starting worker isn't blocked, but the shift cannot be
   started the day before]
4. **Copy-forward scope** — [copies draft/published/confirmed shifts of the source week, skipping
   cancelled/completed; all land as `draft`; participants carried; overlaps re-checked]
5. **Previous-handover match rule** — [same program AND ≥1 shared participant, most recent
   completed shift before this one; if no shared-participant handover exists, show the most recent
   same-program handover as a fallback]
6. **Week-grid day bucketing timezone** — [UTC; `org_settings` has no timezone column (verified),
   only `locale` defaulting to en-AU. Bucketing in the org's local day is deferred until org_settings
   gains a tz column]
7. **`remove_member` rostering handling** — [refuse removal while the member has any future
   published/confirmed shift; otherwise null `worker_id` on their past shifts and cascade
   `created_by` to NULL. Implemented in the 090/091 RPC fix, not a rostering migration]
