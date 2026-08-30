# Companion — Gap Report handoff (2026-08-25)

Written for a fresh session to pick up and execute. Two source documents drove this:
`C:\Temp\Companion-Gap-Report.md` and `C:\Temp\Companion-Team-Mode-Spec.md`. **Both are partially
stale** — every claim below has been independently re-verified against the actual live codebase
(migrations up to `083`, all of `src/`) as of 2026-08-25, not trusted from the documents. Where the
documents were wrong, that's flagged explicitly so it isn't re-litigated.

This is **separate** from the identity/multi-plan-linking work tracked in
`IMPLEMENTATION-QUEUE.md` — that thread (persons/profile_orgs/active-context/linking/plan-switcher)
is **fully complete and deployed** as of `0.5.129`. Don't re-derive it; read that file if it's
relevant, otherwise this doc's scope is entirely different: NDIS compliance, Programs, Rostering,
revision history, and commercial-surface gaps.

---

## 0. The one thing that changes priority order — read this first

The gap report frames everything below as "missing features." One of them isn't a missing
feature — it's an **active, ongoing compliance gap in code that already ships**:

**`log_entries` and `incidents` can already be edited today, in the live app, with zero audit
trail.** Not "there's no revision table" in the abstract — real UI, right now, does a plain
destructive `UPDATE` with no `edited_by`/`edited_at` capture:
- `src/pages/worker/WorkerClientDetail.tsx:147-174` (`startEdit`/`updateLog`)
- `src/pages/coordinator/CoordinatorClientDetail.tsx:347`
- `src/pages/family/FamilyDashboard.tsx:995`
- `src/components/IncidentDetail.tsx:25-33` (coordinator escalate/resolve, overwrites `status`/`resolution_notes`)

There's also a permission flag `edit_own_entry` (`src/hooks/usePermissions.ts`) that's defined but
**not actually consumed** by any of the three log-entry edit call sites above — they only check
`author_id = auth.uid()`, not the permission. Worth fixing alongside the revision work, not a
separate ticket.

`behaviour_notes` is immutable **only because no UI happens to call its still-live, still-dangerous
UPDATE policy** (`"workers can flag notes"`) — wait, that one's actually already fixed: migration
`073`'s A1 dropped it. Confirmed dead and gone. Good — one less thing.

**Recommendation: build `record_revisions` and wire it into these exact three/four edit paths
before anything else in this doc.** Everything else here is a genuine gap (a missing feature);
this one is a live product actively contradicting its own compliance requirement.

---

## 1. Verified status table

| Item | Gap report says | Actually verified 2026-08-25 |
|---|---|---|
| `record_revisions` | Missing entirely | **Confirmed missing.** Zero references anywhere. No `edited_by`/`edited_at` on any table. |
| `incidents` | Missing entirely | **FALSE — fully built.** `053_incidents.sql`, full UI (`IncidentForm`/`IncidentsSection`/`IncidentCard`/`IncidentDetail`), wired into coordinator dashboard. Gap report is simply wrong here. |
| `restrictive_practices` | Missing entirely | **Confirmed missing.** Zero references outside the two design docs. |
| `behaviour_support_plans` | Missing entirely | **Confirmed missing.** Zero references outside the two design docs. |
| Server-side `exports` | Missing (implied — "buttons with nothing behind them") | **Confirmed missing**, and narrower than described: the only export is `notesToCsv()`/`downloadCsv()` (`src/lib/behaviourNotes.ts:21-47`), pure client-side, behaviour-notes-only, zero audit logging, zero network call. |
| `programs`/`program_participants`/`program_workers` | Never built | **Confirmed.** Zero tables, zero UI. Spec exists (`docs/superpowers/specs/2026-08-24-programs-design.md`) but explicitly paused — "needs re-slicing," 3 adversarial reviews found ~14 defects. |
| `rostering` (`shifts`/`shift_participants`/`shift_handovers`) | Never built, "On shift" hardcoded | **Tables confirmed missing.** The "On shift · 9:00–3:00" string exists only in `public/investor-deck.html` (static marketing collateral, not part of the React app) — there is no worker-facing "on shift" UI in `src/` at all, hardcoded or otherwise. The feature doesn't exist, full stop. |
| `medication_tracking` | Roadmap, not built | **FALSE — fully built and correctly gated.** `ClientManagePanel.tsx:35`, `Account.tsx:50`, `FamilyDashboard.tsx:829`. |
| `goals` | Roadmap, not built | **FALSE — fully built.** But see §3 below — it's incorrectly conflated with `ndis_records`. |
| `recipient_login` | Doesn't exist as a role | **FALSE — fully built.** Recipient role, own dashboard, gated invite option. See §3 for a server-side gap. |
| Entitlement gating | Not implemented | **Mostly correct**, three real bugs found — see §3. |
| Six-tier commercial surfaces | Still shows 5 tiers, Family+ missing | **Partially true** — see §4. |

---

## 2. NDIS compliance — build order

All four remaining items share a pattern (per-record history, or a new register table) and should
go in this order:

### 2a. `record_revisions` (do this first — see §0)

```sql
create table companion.record_revisions (
  id            uuid primary key default gen_random_uuid(),
  table_name    text not null,           -- 'log_entries' | 'behaviour_notes' | 'incidents' | 'medication_logs'
  record_id     uuid not null,
  previous_data jsonb not null,          -- full row snapshot before the edit
  edited_by     uuid not null references companion.profiles(id),
  edited_at     timestamptz not null default now()
);
```
Simplest correct implementation: a generic `BEFORE UPDATE` trigger (one function, attached to each
of the four tables) that inserts `OLD` as a JSONB snapshot before the update proceeds — mirrors the
`enforce_participant_seats()` trigger pattern already established in `055`. Retention: ~7 years,
soft-delete only (never actually delete a revision row).

Then: fix the three-four call sites in §0 to remain functionally identical (they don't need to
change at all if the trigger approach is used — that's the point of a trigger over touching every
call site individually, same lesson as migration `082`'s fix this session).

### 2b. `restrictive_practices` register

Per the gap report: type (chemical/environmental/mechanical/physical/seclusion), authorised or not,
authorisation reference, linked behaviour-support plan, duration. **"Unauthorised use automatically
creates a reportable incident"** — this needs a trigger inserting into `companion.incidents` (which
already exists, so no new incident schema needed) when `authorised = false` on insert.

### 2c. `behaviour_support_plans`

Per participant, attachable (likely a Storage file reference, matching how photos already work —
check `photo_path`/Storage bucket patterns already in `log_entries`), review-due date.
`restrictive_practices` should FK to this once both exist.

### 2d. Exports rebuild — the biggest of the four

Current state is one client-side CSV button for behaviour notes only. The spec wants: PDF/CSV for
participant record, goal progress, medication record, incident register, restrictive-practices
register, claim summary — **access-controlled and audit-logged**. This has to be server-side (an
edge function or RPC) specifically so it can write an `access_log` entry (or a widened version of
it — see §3, `access_log` today is hardwired to `behaviour_notes` only via a non-nullable
`note_id` FK and a three-value `action` check constraint; either widen that table or add a sibling
`export_log`). Don't build this until 2a-2c exist, since exports are meant to include their content.

---

## 3. Entitlement-gating bugs found (fix these — small, contained)

1. **`ndis_records` and `goals` share one entitlement key in-app, but the spec wants them to
   diverge** (goals includes Family+; ndis_records excludes Family+ and Family entirely). Live
   code: `WorkerClientDetail.tsx:128` and `ClientManagePanel.tsx:315-319` both gate the
   `NdisRecordsSection` component on `has(FEATURES.goals)` — there is no `ndis_records` key
   anywhere in `src/` or `mab-features.json`. If MAB grants `goals` to a Family+ org (which per
   spec it should), that org's UI will incorrectly also show NDIS progress-record entry. **Fix:**
   either add a real `ndis_records` key and gate `NdisRecordsSection` on it instead of `goals`, or
   decide the two should genuinely be one key (a product decision, not a code decision — confirm
   which before touching this).

2. **`recipient_login`/`therapy_circles` have no server-side backstop.** `invite-member`
   (`supabase/functions/invite-member/index.ts:55-63`) authorizes purely via sub-role permission
   RPCs — it never checks the actual MAB entitlement. A direct API call with a valid sub-role
   permission but no `recipient_login`/`therapy_circles` entitlement would still succeed. Same
   class of gap as the Pass B work already done for `behaviour_notes`/`medications`/etc.
   (`074`/`076` — `org_has_feature()` already exists, just needs wiring into this specific edge
   function).

3. **`retention_30` has no real server-side enforcement.** The actual delete logic
   (`FamilyDashboard.tsx:1060-1084`) only runs once per browser session, client-side, when a family
   member happens to load `/family`. The **old server-side purge function was deliberately
   neutered** (`052_retention_by_entitlement.sql` turned `delete_expired_family_entries()` into a
   no-op with a comment explaining it "can't read MAB entitlements" — correct reasoning, but the
   result is nothing server-side ever purges expired data anymore). Real fix: a scheduled job
   (edge function + `pg_cron`, matching the `timer-alerts-dispatch` cron already live) that reads
   `organisations.entitlements` (built in migration `074` — already has the `retention_<n>` key
   available!) directly, no MAB round-trip needed. This is now actually easy given `074`'s work —
   wasn't when `052` was written.

---

## 4. Six-tier commercial surfaces

The app's *logic* already anticipates six tiers (`isFamilyPlan()` in `planCheck.ts` explicitly
handles both `companion_family` and `companion_family_plus`, with a comment saying no code change
is needed for more family tiers). The gap is narrower than the report claims:

- **`src/lib/catalog.ts`'s `FALLBACK` constant is stuck at 4 tiers** (`companion_family`,
  `companion_solo`, `companion_starter`, `companion_team` — no `family_plus`, no `enterprise`).
  This is what renders on Landing/Step2Plan whenever the live MAB catalog call fails. Fix: add the
  missing two tiers to this fallback so a degraded state doesn't silently drop them.
- Landing page pricing table is already dynamic/6-tier-capable when the live catalog call
  succeeds — no fix needed there.
- Step2Plan.tsx deliberately shows only 3 tiers (Solo/Starter/Team) — correct by design, provider
  setup wizard, not a bug.

**The Team billing seat-vs-usage-meter "open question" flagged in both source docs as "ask before
implementing" is actually already resolved — don't re-ask it.** Companion already has a generic
`organisations.metered_axis`/`seats` mechanism (migration `055`, long-lived, already working) that
reads whatever MAB says per-org — confirmed live: The Friendship Circle (Team) is
`metered_axis='workers', seats=100`, i.e. **seat-based**, not the `active_clients` usage meter the
integration doc guessed at. The app never hardcodes which model applies; it already reflects MAB's
actual live config generically. No decision needed, no code change needed — this line item in both
source docs is stale.

---

## 5. Programs — re-slicing needed before implementation

Spec exists in full at `docs/superpowers/specs/2026-08-24-programs-design.md`, already
adversarially reviewed (3 rounds, ~14 defects found and corrected in the doc itself). **Do not
implement it as originally scoped** — it's larger than the agreed "foundation + primary surfaces"
slice. Before writing any migration:
1. Re-read the spec's own corrections (the defects are fixed in the doc, not just noted).
2. Confirm with David which slice ships first — full Programs (with billing dedup, program filters
   across 6+ surfaces, worker access via program membership) is a multi-week feature on its own.
3. One prep task is already agreed regardless of slicing: rewrite the ~12 inlined `client_workers`
   predicates (`incidents`, `ndis_records`, `participant_goals`, `goal_progress_records`,
   `active_timers` — see `IMPLEMENTATION-QUEUE.md` item 7) to call `client_ids_for_worker()`
   instead. This is what makes program-derived access reach those tables later, and independently
   gives them `069`'s cross-tenant org test, which they never received. Safe to do now, before
   Programs itself.

## 6. Rostering — from scratch, do this after Programs (not before)

Rostering's own spec section (`Companion-Team-Mode-Spec.md` §3) makes shifts belong to a program
(`shifts.program_id`), so building rostering before Programs exist means building on a foundation
that doesn't exist yet. No design doc exists for this one yet — write one first, following the same
adversarial-review discipline used for Programs and the identity model (a design spec, reviewed
before implementation, not written straight into migrations).

---

## 7. Suggested order

1. `record_revisions` + wire into the 3-4 already-live edit paths (§0, §2a) — closes an active gap, not just a missing feature
2. The three entitlement-gating bugs (§3) — small, contained, no new tables
3. `restrictive_practices` + `behaviour_support_plans` (§2b, §2c)
4. Exports rebuild (§2d) — biggest of the NDIS items, depends on 1-3 existing
5. Catalog fallback fix (§4) — trivial, do whenever convenient
6. Programs re-slicing conversation with David, then implementation (§5)
7. Rostering design spec, then implementation (§6)

---

## 8. Source documents

- `C:\Temp\Companion-Gap-Report.md` — the original ask, partially stale (see §1)
- `C:\Temp\Companion-Team-Mode-Spec.md` — behaviour spec + acceptance checklist (§16), Programs §2, Rostering §3
- `C:\Temp\Claude-Code-Kickoff-Prompt.md` — original build brief. Note: the gap report claims this
  was "rewritten" with a detailed NDIS §11 — **that rewritten version doesn't exist as a file
  anywhere found on this machine**. The copy at `C:\Temp\` has only the original short §11
  ("Compliance must-dos" — 7 bullet points, not the detailed record_revisions/restrictive_practices
  spec). Treat the Gap Report's own Priority 1 section as the authoritative NDIS detail — no more
  detailed source exists.
- `C:\Temp\SarahCareCoordination\build-package\handoff\Companion-MyAppBuddy-Integration.md` — billing
  integration doc, **partially superseded** — see §4's billing note.
