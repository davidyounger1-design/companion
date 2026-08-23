# Companion — Privacy & access-control hardening (design spec)

Status: approved in principle by David 2026-08-24. Pass A is intended to ship immediately.
Prompted by: three adversarial reviews of `2026-08-24-programs-design.md`, which surfaced that several
findings were **live production issues unrelated to Programs**. This spec extracts and fixes those.

**Every claim below was verified against the repo, not inferred from a source document.** Where a
reviewer's claim turned out to be wrong, that is recorded too — two of the three reviewers made at least
one factual error, and this document should not launder them.

---

## 1. The systematic flaw

Almost every RLS policy in this app answers *"can this person **reach** this participant?"* Very few also
ask *"should this person see this **kind of record**?"* Reach and record-sensitivity are conflated: once a
subject is inside `public.client_ids_for_worker()` they receive journal entries, behaviour notes, feedback
and moods alike, with **no role test**.

This is why the Programs design was dangerous. Programs adds a *second* path into
`client_ids_for_worker()` (shared program membership), and `program_workers` as specced had no role
constraint — so a coordinator could place a therapist, family member, or the participant themselves into a
program and they would inherit every behaviour note in it. **The hardening below must land before Programs**,
or Programs multiplies an existing weakness rather than inheriting a sound foundation.

What is genuinely well designed, and must not be damaged by this work: the `note_shares` consent model
(per-note, per-therapist explicit grants; flag ≠ share; only the decision-maker may share; revocation sets
`revoked_at` rather than deleting; `access_log` records view/share/revoke), the therapist's own narrow
policy, and `my_org_id()`'s fail-closed NULL behaviour.

---

## 2. Pass A — RLS corrections (urgent; no new tables, no frontend changes)

Pure policy and function corrections. No schema additions, no UI work, no MAB configuration. Shippable
independently and immediately.

### A1 · Drop the unused `behaviour_notes` UPDATE policy — worst hole, cheapest fix

Live policy (`013:214-216`):
```sql
create policy "workers can flag notes"
  on behaviour_notes for update
  using (client_id in (select public.client_ids_for_worker()));
```
No `with check` (so it defaults to the `using` clause) and no column restriction. Any subject with worker
reach can rewrite **any field of any behaviour note** for that participant — including `client_id`, which
re-parents a clinical record into a different participant's and a different family's view, and
`include_in_summary`, which controls whether it reaches the family digest.

**Verified 2026-08-24: this policy is dead code.** `grep` across `src/` and `supabase/functions/` finds
**zero** UPDATE call sites on `behaviour_notes`. `flagged_for_review` is written once, at INSERT
(`BehaviourNoteForm.tsx:72`), and is read-only everywhere else. Dropping the policy therefore removes the
attack surface with no regression, and it *aligns* with Team-Mode-Spec §5.2's requirement that notes be
"effectively immutable: edits create a revision … no silent overwrite."

```sql
drop policy if exists "workers can flag notes" on companion.behaviour_notes;
```

Before running, enumerate all policies on the table and confirm no *other* UPDATE path is being removed by
accident:
```sql
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr,
       pg_get_expr(polwithcheck, polrelid) as check_expr
from   pg_policy where polrelid = 'companion.behaviour_notes'::regclass order by polcmd, polname;
```
If a coordinator or decision-maker UPDATE path exists and is in use, keep it — only the worker one is in
scope here.

### A2 · Add a role test to the `behaviour_notes` SELECT policy

Live policy (`013:210-212`) has no role predicate, so *anything* in `client_ids_for_worker()` reads every
behaviour note for that participant:
```sql
create policy "workers can view behaviour notes"
  on behaviour_notes for select
  using (client_id in (select public.client_ids_for_worker()));
```

```sql
drop policy if exists "workers can view behaviour notes" on companion.behaviour_notes;
create policy "workers can view behaviour notes"
  on companion.behaviour_notes for select
  using (
    public.my_role() in ('support_worker','trusted_support_worker')
    and client_id in (select public.client_ids_for_worker())
  );
```

The IN-list is deliberate: `071` (which retires `trusted_support_worker`) is written but **unrun**, so this
must be correct whether Pass A lands before or after it. After `071` no row holds the retired value and the
second element is inert; `071`'s own cleanup can narrow it to `= 'support_worker'` later.

This narrows nobody legitimate: coordinators reach notes via `"coordinators can view behaviour notes"`
(`004:77`), the decision-maker via their own policy, therapists via `note_shares`. The only subjects losing
access are non-workers who were reaching through the worker path — precisely the bug.

### A3 · Fix the three medication policies that grant org-wide access

`064_medications.sql` uses `public.client_ids_for_org()` — which is `select id from clients where org_id =
public.my_org_id()`, with **no role test** — as an access grant in three places. Consequence, verified:
**every member of an org (family, therapist, and the care recipient themselves) can read *and write*
medication administration records for every participant in that org.**

`medications` SELECT (`064:45`) and `medication_logs` SELECT (`064:102`) — replace the org-wide term with
the worker path:
```sql
-- was:  or client_id in (select public.client_ids_for_org())
        or client_id in (select public.client_ids_for_worker())
```
The surrounding terms (`client_ids_for_recipient()`, `client_ids_for_family()`, and the coordinator branch
already gated by `public.my_role() = 'coordinator'`) stay untouched, so recipient, family and coordinator
access is preserved exactly.

`medication_logs` INSERT (`064:106-112`) — the write hole:
```sql
drop policy if exists "team members can insert medication logs" on companion.medication_logs;
create policy "team members can insert medication logs"
  on companion.medication_logs for insert
  with check (
    administered_by = auth.uid()
    and org_id = public.my_org_id()
    and ( client_id in (select public.client_ids_for_worker())
       or client_id in (select public.client_ids_for_family())
       or (public.my_role() = 'coordinator'
           and client_id in (select public.client_ids_for_org())) )
  );
```

**`client_ids_for_family()` must be retained here, deliberately.** In a family org the family *is* the
carer and administers medication — and the one live org (`Sarah Younger's Care Circle`) is a family org.
Dropping that term would be a real regression for the only real user.

**Recipient is deliberately excluded from INSERT.** The UI never offers it — `FamilyDashboard` passes
`canManage={isCoordinator || isFamily}` to `MedicationList` — so removing the RLS capability matches
existing behaviour rather than narrowing a live flow. If self-administration is wanted later, add it
explicitly as a product decision.

`064:55` (`medications` SELECT, coordinator branch) is already correctly gated and needs no change.

### A4 · Role-test `client_ids_for_org()` — closes the enumeration primitive

Currently granted to `authenticated` (`013:74-83`) with no role test, so any org member can call
`rpc/client_ids_for_org` and enumerate **every participant UUID in their org**. That is both a targeting
primitive for any future write attack and, in itself, a disclosure of who a provider's clients are.

```sql
create or replace function public.client_ids_for_org()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select c.id from companion.clients c
  where c.org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
$$;
```

**Mandatory pre-flight: enumerate every caller and confirm each is either already coordinator-gated or
fixed by A3.** Known callers at time of writing — `033` (`schedule_items`), `035`/`066` (`active_timers`),
`064` (medications, fixed in A3), `013` — appear to wrap it in an explicit `my_role() = 'coordinator'` test
already, which makes the change a defence-in-depth no-op for them and a real fix for the medication paths.
Verify exhaustively before running; a caller that legitimately needs non-coordinator access would break
silently (returning zero rows, not erroring):
```sql
select n.nspname, c.relname, pol.polname, pg_get_expr(pol.polqual, pol.polrelid),
       pg_get_expr(pol.polwithcheck, pol.polrelid)
from   pg_policy pol
join   pg_class c on c.oid = pol.polrelid
join   pg_namespace n on n.oid = c.relnamespace
where  coalesce(pg_get_expr(pol.polqual, pol.polrelid),'')
    || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid),'') like '%client_ids_for_org%';
```

### A5 · Add the missing org test to `client_ids_for_family()` — but NOT to the therapist helper

`069` gave `client_ids_for_worker()` a cross-tenant org test. `client_ids_for_family()` (`013:34-37`) never
received one, so a detached family profile (whose `org_id` is NULL after `remove_member`, or was re-homed
by `accept_invite`) retains reads against its former org.

```sql
create or replace function public.client_ids_for_family()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select cf.client_id
  from   companion.client_family cf
  join   companion.clients c on c.id = cf.client_id
  where  cf.family_id = auth.uid()
    and  cf.status = 'active'
    and  c.org_id = public.my_org_id()
$$;
```
(Reconcile the non-org-test portion against `pg_get_functiondef` first — `060`'s sweep rewrote these bodies
in place. This is the trap that produced a real defect in the Programs spec.)

**`client_ids_for_therapist()` is deliberately left alone.** A reviewer recommended org-testing it for
symmetry. That would be **wrong** and would break a stated product requirement: David confirmed
2026-08-24 that therapists are common to the *participant*, not the org — Sarah Younger's therapist should
see notes shared from both The Friendship Circle (Team plan) and her private family plan. Therapist access
is intentionally person-scoped; its safety rests on circle membership requiring decision-maker approval and
on `note_shares` being an explicit per-note grant, not on org boundaries. Adding an org test here would
fight the product.

**Interaction to be aware of:** A5 is the exact policy the future multi-org work would need to revisit —
that work replaces the org test with a *person*-scoped test, rather than simply removing it. Doing A5 now
is still correct: a detached family profile should not retain access under any model.

---

## 3. Pass B — server-side entitlement enforcement

**The gap.** Entitlement gating is browser-only. `RequireFeature` is a React component (`src/App.tsx:113`)
and `fetchFeatures()` is client-side (`src/lib/features.ts`); no RLS policy or RPC consults entitlements. So
a subscription without `behaviour_notes` or `medication_tracking` can still read and write those tables by
calling the Supabase API directly with a valid session. `055`'s own header describes this exact class of
bug for seat caps — *"previously enforced only in the browser … bypassable via a slow network, multiple
tabs, or calling the Supabase API directly with a valid session"* — and the fix pattern already exists.

**Follow the `055` precedent.** It mirrors plan data onto `organisations` (`seats`, `metered_axis`), kept in
sync by `reconcileOrgPlan` on login (`src/lib/reconcilePlan.ts`, called from `AuthContext.tsx:72`), and
enforces server-side with a trigger.

1. `alter table companion.organisations add column if not exists entitlements jsonb not null default '{}'`
2. Extend `reconcileOrgPlan` to write the fetched feature set into it on login.
3. Add `public.org_has_feature(text)` — `stable security definer`, reading
   `organisations.entitlements` for `my_org_id()`, **fail-closed** on absent key or absent row.
4. Gate the most sensitive tables on it, as **restrictive** policies (the `072` mechanism — a restrictive
   policy can only narrow, never widen): `behaviour_notes`, `medications`, `medication_logs`,
   `participant_goals`, `incidents`.

**Known weakness of this pattern, stated plainly:** sync happens on login, so an org nobody logs into keeps
stale entitlements. That is the same weakness `055` already accepts for seats. A webhook-driven sync would
be stronger and is worth considering, but matching the existing pattern is the smaller, more reviewable
change.

**Sequencing:** Pass B must not ship before Pass A. A restrictive entitlement gate over a permissive policy
that is itself too broad produces a confusing half-secure state, and B's failure mode (a legitimate org
locked out by a sync bug) is far more visible than A's.

---

## 4. Pass C — audit coverage (deferred, and why)

Team-Mode-Spec §15 requires *"every note view / share / revoke **and every export** written to `access_log`
and surfaced to family."* Reality, verified: `access_log` exists (`004:32`) and covers behaviour-note
view/share/revoke. **Exports write nothing** — the only export is a client-side CSV
(`BehaviourNotesSection.tsx:54` → `downloadCsv`), which the server never observes and therefore cannot
audit. There is no audit on medication administration, incidents, or journal access.

Auditing exports **requires rebuilding exports** as a server-side operation (RPC or edge function), which
is already its own deferred cycle — the current export capability is one CSV button covering behaviour
notes only, with no PDF, no goals or medication content, and no program scoping. Folding audit into that
cycle avoids building an audit path for a subsystem that is about to be replaced.

In scope for Pass C when it runs: audit on medication administration writes (cheap — a trigger writing to
`access_log`, or a widened audit table), export auditing alongside the exports rebuild, and a decision on
whether `access_log`'s current note-only shape should generalise.

---

## 5. Migrations & ordering

| File | Contents | Depends on |
|---|---|---|
| `073_privacy_hardening_rls.sql` | All of Pass A (A1–A5) | Nothing. **Explicitly independent of `071`/`072`**, which are written but unrun — A2's role IN-list is correct in either order. May run before them. |
| `074_entitlements_server_side.sql` | Pass B items 1, 3, 4 | `073`. Item 2 is a frontend change shipped alongside. |

Both files: wrapped in `begin; … commit;`, every statement idempotent (`drop policy if exists` before
`create policy`, `add column if not exists`, the `068:271-291` `do $$ … pg_constraint` guard shape for
constraints), every object schema-qualified `companion.*` (bare names resolve against the SQL editor's
`public` search_path — the trap that broke `062`), and `enable row level security` + `revoke` immediately
after any `create table` rather than in a later section, so a torn paste fails closed under `060`'s
default-privileges regime.

Programs is renumbered to `075`+ and re-sliced separately, after `073` is verified live.

---

## 6. Verification

Structural, post-`073`:
1. `"workers can flag notes"` no longer exists on `companion.behaviour_notes`, and no other UPDATE policy
   was removed with it (compare the policy enumeration from A1 before and after).
2. No policy on any table still references `client_ids_for_org()` outside a coordinator-gated branch (re-run
   A4's caller query).
3. `pg_get_functiondef` on `client_ids_for_org`, `client_ids_for_family`, `client_ids_for_worker` — captured
   **before** the paste and diffed after; the only deltas are the intended ones. This capture *is* the
   rollback artifact for the three `create or replace` statements, which are otherwise destructive
   overwrites of definitions that may exist in no file.

Behavioural — direct API probes, signed in as each role, because RLS is only proven from outside the app
(and with the `Content-Profile: companion` header, or PostgREST looks in `public` and returns a misleading
404 that proves nothing):
4. **A family member** in Sarah's org queries `medication_logs` for a participant they are **not** linked
   to → zero rows. Before `073`, this returns rows.
5. **The same family member** attempts `POST /rest/v1/medication_logs` for an unlinked participant → refused
   (`42501`). And for their **own linked** participant → **succeeds** (this half matters as much: it proves
   the fix didn't break the live org's real workflow).
6. **A therapist** queries `behaviour_notes` → returns only notes with a live `note_shares` row, even if
   they hold a `client_workers` row.
7. **A recipient** calls `rpc/client_ids_for_org` → zero rows.
8. **A detached family profile** (`org_id` NULL) queries `clients` → zero rows.
9. **A support worker** queries `behaviour_notes` for an assigned participant → still returns them (proves
   A2 didn't over-narrow).

Post-`074`: an org whose `entitlements` lacks `behaviour_notes` cannot read the table by direct API even
with a valid session, and an org that has it is unaffected. Both halves required — a gate that always
denies looks identical to a working one if only the negative case is tested.

---

## 7. Out of scope, and corrections to the reviews

**Out of scope:** the Programs feature itself (own spec, re-sliced, after this); the NDIS compliance tables
(`record_revisions`, `restrictive_practices`, `behaviour_support_plans`); the exports rebuild; multi-org
participant identity (`clients.person_id` / `profile_orgs`) — sketched but undesigned, and see A5's
interaction note; the `Family +`/Enterprise commercial tiers.

**Reviewer claims rejected after verification** — recorded so they are not resurrected:
- *"`WorkerNoticeBoard.tsx:32` filters `.eq('status','active')` on `client_workers`, which has no `status`
  column, so the query always errors and the board renders empty."* **False.** No `status` filter exists in
  that file, or anywhere in `src/` referencing `client_workers`. A background task was spun up on this
  premise and should be cancelled.
- *"`incidents` doesn't exist in the live repo, so `alter table incidents` has no table to alter."*
  **False.** `053_incidents.sql` exists; `IncidentForm`/`IncidentsSection` ship; the coordinator dashboard
  queries it (`CoordinatorDashboard.tsx:33`). This reviewer trusted `Companion-Gap-Report.md` — which is
  substantially out of date — over the repo.
- *"Org-test `client_ids_for_therapist()` for symmetry."* **Rejected on product grounds** — see A5.

**A live gap this spec does not close:** five tables inline `select client_id from client_workers where
worker_id = auth.uid()` instead of calling `client_ids_for_worker()`, and therefore never received `069`'s
org test: `incidents` (`053:43,51`), `ndis_records` (`054:54,74,80`), `participant_goals` and
`goal_progress_records` (`058`, ×6), `active_timers` (`066`, ×3). David has already agreed to rewrite these
to use the shared helper — but that work belongs to the Programs cycle, because it is *also* what makes
program-derived access reach those tables. Noted here so the gap is tracked in one place rather than
implicitly owned by neither spec.
