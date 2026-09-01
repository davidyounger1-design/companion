# Rostering Redesign — Design

Date: 2026-09-01 · Status: design approved in chat, NOT implemented · Author: Claude Code + David Younger

Supersedes the rostering portions of `docs/superpowers/specs/2026-08-24-rostering-design.md`
(v1 "lite"), which shipped as migrations 091–095 and `src/pages/coordinator/Rostering.tsx`.
The current-state audit that this design argues from is `ROSTERING-CURRENT-STATE.md` at the
repo root — read its section 0 first.

> **Not legal advice.** Sections 5 and 7 summarise the SCHADS Award (MA000100) and NDIS
> Commission obligations from primary sources for the purpose of shaping software. Award
> interpretation is genuinely contested in places. Confirm with Fair Work (13 13 94) or a
> workplace lawyer before relying on any of it operationally.

---

## 1. Why this exists

Rostering v1 shipped a data model and a week-grid UI, and is **not usable end-to-end**. Beyond
that blocker, the model is missing concepts the sector treats as mandatory (shift types,
credential gating, worked-time reconciliation) and is shaped in ways that will not extend
(templates hard-require a worker and cover exactly one weekday).

This design does two things in one document: **unblocks the existing feature**, then **rebuilds
the model** so it can carry real provider rostering without a second rewrite.

## 2. Verified current state

Every claim here was confirmed against the code, not inferred from the v1 design doc.

| # | Finding | Evidence |
|---|---|---|
| 1 | **Rostering cannot be used at all.** No UI anywhere assigns a worker or participant to a program. | `assign_worker_to_program` / `assign_participant_to_program` exist (`092_programs_rpcs.sql:60,97`) and are typed (`database.ts:1246,1254`) but have **zero call sites** in `src/`. No `/programs` route in `App.tsx`. `Rostering.tsx:49,63` reads its worker and participant lists from those two permanently empty tables. |
| 2 | `required_skills` is decorative | The column exists (`093:39`) and the UI collects it and warns "worker is missing X" — but neither `rostering_create_shift` (`094:15-18`) nor `rostering_update_shift` (`094:68-71`) has a parameter for it. It can only ever hold its `'{}'` default. `rostering_copy_forward` (`094:308`) faithfully propagates a value that can never be non-empty, and the week grid (`094:335`) returns it for a warning that can never fire. |
| 3 | Drag-to-reassign silently downgrades | Moving a **confirmed** shift cancels and recreates it as an unpublished **draft**, with nothing forcing a republish — a worker who confirmed can silently stop being rostered. |
| 4 | No force-end for abandoned shifts | The RPC supports coordinator force-end; no UI exposes it. A worker stuck `in_progress` can never be removed from the org (`remove_member` blocks). |
| 5 | Templates are structurally narrow | `shift_templates.worker_id` is **not null** (no recurring open shifts) and `day_of_week` is a single int (one row per weekday). |
| 6 | No overlap validation on generate/copy-forward | Templates and copy-forward always emit `draft` with no conflict check and no bulk publish. |
| 7 | All-UTC day bucketing | Day boundaries and cron generation assume UTC; DST-sensitive orgs will see drift. |

**Sequencing consequence:** finding 1 makes everything else moot. Phase 0 exists to fix it.

## 3. Scope (decided)

- **Audience: both, deliberately.** One data model, two experiences. Provider complexity is
  gated by org type and plan entitlement; the family experience never renders it.
- **Depth: roster + actual worked time.** Clock in/out, variance against roster, coordinator
  approval, export. **NDIS claim generation is out** — see §10.
- The shift → funded-line-item relationship is included as a **nullable seam only**
  (§6.1). Nothing in this design reads it. It exists so claiming can be added later without
  restructuring `shifts`.

## 3.1 Clean slate — the rostering tables carry no production data

Confirmed by David 2026-09-01: **nobody uses rostering live.** This follows from finding 1 —
the feature has never been usable end-to-end — and it removes the usual migration-compatibility
burden for this design specifically.

**What that permits:** rostering-owned tables (`programs`, `program_participants`,
`program_workers`, `shift_templates`, `shifts`, `shift_participants`, `shift_handovers`,
`worker_availability`, `profile_skills`) may be dropped and recreated rather than carefully
migrated. Column types may change. No backfill is owed.

**What it does not permit:** everything else in the `companion` schema is live with real
subscribers. `profiles`, `clients`, `persons`, `organisations` and every table this design
*references* stay untouchable. A rostering migration may not alter a shared table's shape to
suit itself.

**Cheap insurance before dropping anything** — confirm the assumption still holds at
implementation time rather than trusting this paragraph:

```sql
select 'shifts' as t, count(*) from companion.shifts
union all select 'shift_templates', count(*) from companion.shift_templates
union all select 'programs',        count(*) from companion.programs
union all select 'program_workers', count(*) from companion.program_workers;
```

Non-zero counts mean somebody started using it after this was written — stop and re-plan the
migration rather than proceeding.

## 4. Non-negotiables

1. **Org isolation is absolute.** Rostering is org-scoped; nothing here introduces a cross-org
   read. All writes stay behind `SECURITY DEFINER` RPCs with `my_org_id()` checks, as v1 does.
2. **Fail closed on entitlements**, as today (`org_has_feature('rostering')`).
3. **The roster never computes money.** It records *why* a shift attracts a rate or allowance;
   payroll applies the figure. See §5.3.
4. **Never rewrite history.** Recurrence edits and pattern changes apply forward only.

## 5. SCHADS Award constraints

Sourced from the consolidated MA000100 PDF (FWC, incorporating amendments to 1 September 2026)
and current Fair Work Ombudsman guidance.

### 5.1 ⚠ The sleepover rules changed on 1 June 2026

Operative from the first full pay period on/after 1 June 2026 (instrument PR798459). **Any
existing design, code, or institutional knowledge predating mid-2026 encodes the old rules.**

| | Before | Now |
|---|---|---|
| Work before + after a sleepover | Two separate shifts, each needing its own 10h break | **One continuous shift** (cl 25.4(c)) |
| Ordinary hours on such a shift | Standard | Up to **12 by agreement**, capped at 8 either side (cl 25.1(c)) |
| Overtime trigger (part-time/casual) | Standard | **10h without agreement, 12h with** (cl 28.1(b)) |
| Evening/night loadings | Whole shift | **Calculated separately per segment** (cl 29.3(d)) |
| Rest break | 10h | May drop to **8h by agreement** for sleepover-adjacent shifts (cl 25.4(b)) |

Three further variation applications are still before the Commission. Treat this area as
**live**, and keep the rules in configuration rather than hardcoded logic where practical.

### 5.2 Enforce / warn / leave to payroll

| Rule | Treatment | Why |
|---|---|---|
| Minimum engagement — 2h (disability/home care), 3h (other SACS) — cl 10.5 | **Enforce** | Pure arithmetic on data the roster already holds |
| 10h rest break between consecutive shifts (8h sleepover-adjacent by agreement) — cl 25.4 | **Enforce** | Needs cross-shift knowledge only the roster has; payroll sees timesheets in isolation |
| Broken shift: max 2 unpaid breaks, 12h span, agreement flag for 2-break — cl 25.6 | **Enforce** | The roster is the only place that knows the shift's shape |
| Part-time guaranteed-hours pattern — cl 10.3 | **Enforce** (flag variation) | Free-rostering a part-timer against their agreed pattern creates a live breach |
| Sleepover / 24h-care / excursion as distinct **types** — cl 25.7–25.9 | **Enforce** | Pay mechanics and consent requirements differ structurally; see §6.2 |
| 7-day roster-change notice — cl 25.5(d) | **Enforce, with named-exception override** | Legitimate exceptions exist (swap, illness, emergency) that software can't detect |
| Approaching 38h/week or 76h/fortnight | **Warn** | Depends on the whole roster period, not this shift |
| Penalty/loading boundaries (evening, night, weekend, public holiday) | **Warn / display** | Useful to see cost of nudging a shift 15 min; interacts with overtime in error-prone ways |
| Casual worked a regular pattern for N months | **Warn** | Feeds NES casual-conversion rights; a manager judgement, not a block |
| Every dollar figure — allowances, loadings, overtime arithmetic, casual loading, super | **Payroll** | Indexed percentages that move each 1 July; duplicating them guarantees drift |

### 5.3 The costing principle

Live cost-while-scheduling is table stakes across every competitor tier, including the cheapest.
But allowance values are indexed and move constantly — the vehicle allowance is *currently* on a
temporary instrument ($1.05/km until 28 Feb 2027, normally $1.01).

**Resolution:** per-org configurable rates, surfaced as **indicative** cost while building a
roster, never presented or stored as payroll truth. The roster persists *structured reasons*
(`shift_type`, `broken_shift_breaks`, `is_sleepover_adjacent`, `travel_km`), and payroll applies
whatever instrument is in force.

## 6. Data model

All new tables in the `companion` schema, RLS select-only, writes via `SECURITY DEFINER` RPCs —
matching the v1 pattern exactly.

> **Migration numbers:** 097 is taken by `fix/delete-cancelled-shift` (PR #93). Re-check
> `supabase/migrations/` at implementation time and renumber; concurrent sessions ship often.
>
> Per §3.1 these are written as clean creates, not careful alters — but they still run against a
> **live database** that holds real subscriber data in other tables. `drop table` statements must
> name rostering-owned tables explicitly and never cascade into a shared one.

### 6.1 Changes to `shifts`

```sql
alter table companion.shifts
  add column shift_type text not null default 'regular'
    check (shift_type in ('regular','sleepover','active_overnight','24hr_care','excursion')),
  add column pattern_id uuid references companion.shift_patterns(id) on delete set null,
  add column pattern_exception boolean not null default false,
  add column sleepover_adjacent boolean not null default false,
  add column broken_shift_breaks int not null default 0 check (broken_shift_breaks between 0 and 2),
  add column travel_km numeric,
  add column funded_item_ref text;   -- nullable seam; nothing reads it (see §3)
```

`required_skills` already exists on the table but is never written — Phase 0 wires it through
the RPCs (§8).

### 6.2 Why `shift_type` cannot be derived

A sleepover is a **flat allowance** (4.9% of standard rate, $62.87/night at 1 Sep 2026) for an
8-hour window, with a **1-hour minimum at overtime rates** if the worker is woken — not
hours × rate. A 24-hour care shift is **155% of the appropriate rate for 8 hours**, flat, and is
home-care-only and consent-gated. An excursion has its own span rules again. None of these is
inferable from start/end times, and conflating them produces wrong data that flows straight into
payroll's inputs where payroll cannot detect it.

### 6.3 `shift_patterns` — replaces `shift_templates`

```sql
create table companion.shift_patterns (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references companion.organisations(id) on delete cascade,
  program_id      uuid not null,
  worker_id       uuid references companion.profiles(id) on delete restrict,  -- NULLABLE: recurring open shifts
  days_of_week    int[] not null check (array_length(days_of_week,1) between 1 and 7),
  starts_time     time not null,
  ends_time       time not null,
  shift_type      text not null default 'regular',
  start_date      date not null,
  end_date        date,                          -- null = indefinite
  participant_ids uuid[] not null default '{}',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  foreign key (program_id, org_id) references companion.programs(id, org_id) on delete cascade
);
```

Three changes from `shift_templates`, each fixing a v1 limitation: **worker nullable** (recurring
open shifts, currently impossible), **multiple weekdays per pattern** (one row instead of five),
and an explicit **`start_date`**.

**Migration of existing templates:** none needed — per §3.1 the table is empty, so
`shift_templates` is dropped and `shift_patterns` created in its place, with `shifts.template_id`
replaced by `shifts.pattern_id`. Run §3.1's row-count check first; if it returns anything
non-zero, fall back to a real migration (each `shift_templates` row becoming one
`shift_patterns` row with `days_of_week = ARRAY[day_of_week]`, existing shifts repointed rather
than regenerated).

### 6.4 Three-way recurrence editing

Editing a pattern must offer the same three choices every calendar app has trained users to
expect. Anything less violates a near-universal mental model.

| Choice | Behaviour |
|---|---|
| **This shift only** | Detach the shift: set `pattern_exception = true`, edit in place. The pattern stops managing it. |
| **This and all future** | End-date the existing pattern the day before, create a new pattern from this date with the new values. Past and already-generated shifts untouched. |
| **All shifts in the series** | Edit the pattern; regenerate **future, unmodified** shifts only. Never touches shifts in the past, and never touches `pattern_exception = true` shifts. |

### 6.5 `worker_credentials`

```sql
create table companion.worker_credentials (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references companion.organisations(id) on delete cascade,
  profile_id   uuid not null references companion.profiles(id) on delete cascade,
  kind         text not null check (kind in
                 ('ndis_worker_screening','wwcc','police_check','first_aid','cpr',
                  'manual_handling','medication','drivers_licence','other')),
  label        text,
  identifier   text,
  issued_on    date,
  expires_on   date,
  verified_by  uuid references companion.profiles(id),
  verified_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index on companion.worker_credentials (org_id, profile_id, expires_on);
```

### 6.6 `shift_timesheets` — worked time, separate from the roster

The roster is the **plan**; the timesheet is a **separate record** of what happened, reconciled
against it. This is universal across every product studied — none treats worked time as "the
shift unless overridden."

```sql
create table companion.shift_timesheets (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references companion.organisations(id) on delete cascade,
  shift_id            uuid not null references companion.shifts(id) on delete cascade,
  worker_id           uuid not null references companion.profiles(id) on delete restrict,
  scheduled_starts_at timestamptz not null,   -- snapshot at clock-in; roster may change later
  scheduled_ends_at   timestamptz not null,
  clock_in_at         timestamptz,
  clock_out_at        timestamptz,
  break_minutes       int not null default 0,
  travel_km           numeric,
  status              text not null default 'pending'
                        check (status in ('pending','auto_approved','needs_review','approved','rejected')),
  variance_reason     text,
  reviewed_by         uuid references companion.profiles(id),
  reviewed_at         timestamptz,
  review_note         text,
  created_at          timestamptz not null default now(),
  unique (shift_id)
);
```

**No-show is derived, not a status.** A shift that has occurred with no timesheet row (or a row
with no `clock_in_at`) *is* the no-show signal. Every product studied models it this way; adding
a `NO_SHOW` shift status would create two sources of truth that drift.

### 6.7 `rostering_settings` — per-org configuration

```sql
create table companion.rostering_settings (
  org_id                    uuid primary key references companion.organisations(id) on delete cascade,
  late_grace_minutes        int     not null default 15,
  min_engagement_hours      numeric not null default 2,
  rest_break_hours          numeric not null default 10,
  roster_change_notice_days int     not null default 7,
  block_expired_screening   boolean not null default true,
  timezone                  text    not null default 'Australia/Sydney'
);
```

`timezone` addresses current-state finding 7 — day bucketing and generation currently assume UTC.

## 7. Credential gating — deliberately stricter than the market

**Every competitor studied warns and allows override.** This design **hard-blocks** on one
credential: NDIS Worker Screening.

The reasoning: a provider must be able to demonstrate to an NDIS Commission audit that it *never*
rostered a worker into a risk-assessed role without a current clearance. Unlike a penalty-rate
error, this is not correctable after the fact — the roster itself is the evidence. The check runs
5 years, and **the first cohort (issued 2021) began expiring 1 February 2026** — that wave is live
now, not hypothetical.

| Credential | Expired | Expiring within 30 days |
|---|---|---|
| `ndis_worker_screening` | **Hard block** assignment (override requires disabling `block_expired_screening` org-wide, which is logged) | Warn on assignment; dashboard surfaces it |
| Everything else | Warn with override + reason | Warn |

Blocking applies at **assignment time** (create, update, claim, drag-reassign, pattern
generation) — not just at publish, because a draft roster is still the thing a coordinator
works from.

## 8. Phases

Each phase is independently shippable and leaves the app working.

### Phase 0 — Make it usable (blocker)

Nothing else matters until a coordinator can staff a program.

1. **`/programs` route** — coordinator-only. List, create, edit, archive. Per-program panels to
   assign/remove workers and participants, wiring the six RPCs that already exist and are already
   typed. Reuse `ClientManagePanel`'s picker interaction, as the v1 spec originally intended.
2. **Wire `required_skills`** through `rostering_create_shift` / `rostering_update_shift`. It is
   currently collected, warned on, and discarded — actively misleading.
3. **Fix drag-reassign** — carry the original status forward when there's no conflict; if a
   downgrade to draft is genuinely required, make the "needs republish" state loud and blocking.
4. **Coordinator force-end** on the shift detail modal. The RPC already supports it; this is the
   only recovery from an abandoned `in_progress` shift, which currently also blocks member removal.

### Phase 1 — Shift types and recurrence

5. `shift_type` and the associated columns (§6.1); type-specific required fields in the shift form.
6. `shift_patterns` replacing `shift_templates`, with multi-day and nullable worker (§6.3).
7. Three-way recurrence editing (§6.4).
8. Overlap validation on pattern generation and copy-forward, and a bulk-publish action.

### Phase 2 — Credentials and compliance

9. `worker_credentials` + a credential panel on the member record.
10. Hard block on expired NDIS Worker Screening; warn on the rest (§7).
11. SCHADS enforcement: minimum engagement, 10h rest break, broken-shift limits, 7-day change
    notice with named-exception override (§5.2).
12. Warnings: approaching 38h/76h, penalty boundaries, casual regularity.

### Phase 3 — Worked time

13. `shift_timesheets` + clock in/out from the worker's shift view.
14. Variance reconciliation against `late_grace_minutes`; auto-approve inside tolerance, route
    variances to a coordinator queue.
15. Derived no-show reporting.
16. CSV export shaped for payroll import (structured reasons, no dollar figures — §5.3).

### Phase 4 — Differentiators

17. **Behaviour support plan + restrictive-practice authorisations on the worker's shift view.**
    Both registers already exist. The NDIS research found **no competitor doing this** — a worker
    opening tonight's shift seeing the strategies in force is a genuine differentiation
    opportunity, and cheap given the data is already there.
18. Indicative cost while scheduling, against a per-org budget (§5.3).
19. Family-mode simplification (§9).

## 9. Family vs provider

One model, two renderings. The family experience must never surface provider machinery.

| Concept | Provider org | Family org |
|---|---|---|
| Programs | First-class; multiple, staffed | Implicit — one hidden default program |
| Shift types | All five | `regular` only |
| Credentials | Tracked, screening hard-blocks | Hidden entirely |
| SCHADS enforcement | On | Off (families aren't employers under the award) |
| Timesheets / worked time | On | Off by default; opt-in if they pay a support worker directly |
| Ratios | Yes | Hidden (always 1:1) |
| Indicative costing | Yes | Off |

Gating is by `organisations.org_type = 'family'` plus plan entitlement, consistent with how the
app already gates `recipient_login` and `therapy_circles`.

## 10. Out of scope / deferred

- **NDIS claim generation and PRODA bulk-upload files.** The `funded_item_ref` seam (§6.1) exists
  so this can be added without restructuring `shifts`; nothing in this design reads it.
- **Any pay calculation.** Rates, loadings, allowance values, overtime arithmetic, superannuation.
- **Service agreements and plan-budget awareness.** Prerequisites for claiming; not needed for
  rostering + worked time.
- **Support ratios as a billing construct.** `shift_participants` already supports multiple
  participants per shift. Ratio-as-price-apportionment is a claiming concept and waits with §10's
  first item.
- **Automated award-rate interpretation.** Out permanently, by principle — see §5.3.
- **Roster of Care reconciliation for SIL.** Real, and needed if SIL providers become a target
  segment; needs the funding model first.

## 11. Verification

Migrations follow the 077–098 house template: INSPECT FIRST (read-only) → migration →
POST-MIGRATION VERIFICATION (structural queries + `do $$` behavioural probes that clean up
after themselves).

**Structural:** every new column/table/constraint exists; RLS enabled and select-only; RPC grants
land on `authenticated` only.

**Behavioural — must be probed explicitly:**
- Phase 0: a coordinator can create a program, assign a worker and a participant, and see both in
  the roster grid. *This is the test that the feature works at all* — it fails today.
- `required_skills` round-trips through create and update.
- Drag-reassigning a confirmed shift does not silently unpublish it.
- **Credential block:** a worker with an expired `ndis_worker_screening` cannot be assigned by
  any path — create, update, claim, drag, or pattern generation. Probe every path; a gap in one
  is a gap in the control.
- **Rest break:** two consecutive shifts <10h apart are refused; sleepover-adjacent with the
  agreement flag allows 8h.
- **Recurrence:** each of the three edit modes touches exactly the intended shifts and **never a
  shift in the past**.
- Timesheet variance inside `late_grace_minutes` auto-approves; outside it routes to review.
- **Family org:** none of the provider machinery renders, and no SCHADS rule fires.

Frontend verification is manual QA plus `npm run build`.

## 12. Open questions

1. **Part-time guaranteed hours** (§5.2) requires storing each worker's agreed pattern. That is a
   contract record the app has no concept of today. Confirm whether Phase 2 should introduce it,
   or whether the enforcement drops to a warning until an employment-terms model exists.
2. ~~**Timezone migration.**~~ **Resolved by §3.1** — there are no existing shifts to re-bucket,
   so `rostering_settings.timezone` can be introduced as the correct behaviour from the start
   rather than as a migration. Build it right the first time; no backfill decision is owed.
3. **Broken shifts** are modelled here as a flag plus break count on one shift. If providers need
   the segments individually costed, they may need to be separate linked shift rows instead.
   Deferred until a real provider asks.
