# Companion — Identity & access model (design spec)

Status: design agreed with David 2026-08-24 through the "cabinet and drawers" model. Not yet implemented.
Scope: how a single human being can be enrolled in more than one plan, who sees across those plans, and how
two enrolments are safely proven to be the same person.

**Sequencing.** This is the largest of the three pieces of work currently designed, and it goes **second**:

1. **Privacy hardening** (`2026-08-24-privacy-hardening-design.md`) — small, urgent, fixes live leaks. First.
2. **This spec** — large, unblocks the business model.
3. **Programs** (`2026-08-24-programs-design.md`) — medium; partly overlaps this spec's worker-access work,
   and needs re-slicing after the adversarial review of it.

Nothing currently live depends on this, so there is no schedule pressure — the only live org is a single
family plan.

---

## 1. The model

**A cabinet is a person. A drawer is that person's enrolment in one plan.**

Sarah Younger attends The Friendship Circle (a Team plan) *and* has her own private family plan for
non-Friendship-Circle activities. Same human, two commercial entities, two drawers in one cabinet.

Who sees what:

| Who | Sees | Reason |
|---|---|---|
| Friendship Circle coordinator | FC drawer only | belongs to one business |
| Family-plan coordinator | family drawer only | belongs to one business |
| Support worker | their plan's drawer, and within it only their assigned participants | narrower than the drawer |
| **Participant** | **every drawer of their own cabinet** | it's their life, not a plan's view of it |
| **Family member** | **every drawer of the cabinet(s) they're linked to** | they care for the person, not the enrolment |
| Therapist | the drawer(s) they were invited into — both if both plans invite them | access accrues per invitation |

**The line that makes this buildable: staff roles switch plans; person-side roles see the person.**

Coordinators and support workers belong to a business, so an explicit plan context is natural for them.
Participants and family belong to a life, not a plan, so they get one merged view.

This is not a cosmetic choice. The alternative — a single merged view for *everyone*, with powers differing
per record — would require every access rule in the system to ask *"what am I in **this record's** plan?"*,
because the same person can be a coordinator in one plan and merely family in another (the realistic
configuration: **mum is coordinator of her own family plan and merely family in The Friendship Circle**).
Under the agreed split, **every surface has exactly one role** and only the *scope* varies. `my_role()`
keeps returning a single answer. That reduces the work from "rework how permission is resolved everywhere"
to "make two read paths person-scoped, and add a plan switcher to staff surfaces."

**Two dimensions, kept separate.** *Scope* (which drawers can I reach?) and *record type* (which kinds of
thing may I see?) are independent. A participant reaches every drawer of their own cabinet but still never
sees care notices, which are staff-facing. Conflating these two is the systematic flaw identified in the
privacy-hardening spec §1; this model must not reintroduce it.

### 1.1 Agreed behaviours

- **Participants do not see notices.** Confirmed 2026-08-24. Current behaviour (`059` excludes recipients)
  is correct and stays. The merged view is a *care-activity* view — journal, timeline, goals, schedule,
  photos — not an administrative one.
- **A support worker may work for both plans.** Real and expected: "support workers often provide multiple
  services." So the plan switcher applies to workers, not just coordinators.
- **Neither coordinator learns the other drawer exists.** Deliberate. A consequence worth stating plainly:
  **no provider can ever be told "this participant also receives support elsewhere."** That is a privacy
  property, and it is also a product limitation someone will eventually ask to remove — the answer should
  be no.
- **A person may hold different roles in different plans.** Most likely shape: coordinator of a family
  plan, family member of a team plan.
- **The plan switcher is hidden when a person belongs to only one plan.** That is every current user, so
  nothing changes for anyone using the app today.
- **After login, a person with a merged view lands on the merged care view**, with the coordinator context
  a deliberate step away.
- **Several participants per family is out of scope for now** (dropped 2026-08-24). One cabinet per family
  for this pass. The existing family↔participant link is already many-to-many, so this is a later
  extension, not a rework.

---

## 2. Data model

### 2.1 The cabinet

```sql
create table companion.persons (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table companion.clients add column person_id uuid references companion.persons(id);
```

`clients` keeps its name and its meaning of "this person's enrolment in one plan" — the historical name is
not worth a rename across ~30 tables. `persons` carries no personal data itself; it is purely the identity
that drawers hang from, so it needs no RLS beyond "no direct access" (all reads go through `clients`).

**Backfill is 1:1**: every existing `clients` row gets its own fresh `persons` row. No behaviour changes,
because a cabinet with one drawer is indistinguishable from today. Linking is then the act of pointing two
`clients` rows at the same `persons` row.

`person_id` stays nullable through the backfill and becomes `not null` afterwards, once verified.

### 2.2 Multi-plan membership

`profiles.org_id` and `profiles.role` are both single columns today — one plan, one role. That is the
blocker.

```sql
create table companion.profile_orgs (
  profile_id  uuid not null references companion.profiles(id) on delete cascade,
  org_id      uuid not null references companion.organisations(id) on delete cascade,
  role        text not null,
  sub_role_id uuid,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,
  primary key (profile_id, org_id)
);
```

`sub_role_id` moves here from `profiles`, because a sub-role is meaningful only within one plan — a worker
could be a "Trusted worker" at FC and an ordinary worker on the family plan. The composite foreign key that
`068` established for `sub_roles` carries over, now anchored on `(profile_id, org_id)`.

`profiles.org_id` / `profiles.role` are **retained and kept in sync** as "primary plan" for the duration of
the migration, so nothing breaks mid-flight; they are dropped only after every reader is moved. See §5.

### 2.3 The active plan context

`my_org_id()` and `my_role()` must keep their existing signatures — they are referenced by essentially
every access rule in the system, and changing their shape is what this design exists to avoid. Instead they
resolve against an **active context**, defaulting to the person's only membership when they have just one.

Two viable mechanisms, and this is a real open choice:

- **(a) A request header** (recommended) — the client sends the active plan on each request; the functions
  read it via `current_setting('request.headers', true)`, falling back to the single membership. Per-request
  and therefore tab-safe: a coordinator can legitimately have FC open in one tab and their family plan in
  another. Costs a small amount of client plumbing on every Supabase call.
- **(b) `profiles.active_org_id`** — the switcher writes a column; the functions read it. Simpler, no client
  changes beyond the switcher itself. But it is shared server-side state, so two tabs fight over it, and
  that is exactly the scenario a two-plan coordinator will hit.

Recommend **(a)**. Whichever is chosen, both functions must **fail closed**: an active context naming a plan
the person is not a member of resolves to no access, never to a default.

---

## 3. Access resolution

### 3.1 Person-scoped read paths (the merge)

Only two helpers change, and only for read:

```sql
-- Family: every drawer of every cabinet I'm linked to.
create or replace function public.client_ids_for_family()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select c2.id
  from   companion.client_family cf
  join   companion.clients c  on c.id = cf.client_id
  join   companion.clients c2 on c2.person_id = c.person_id
  where  cf.family_id = auth.uid()
    and  cf.status = 'active'
$$;
```

Recipient equivalent resolves through `clients.recipient_profile_id` to the person, then back out to all of
that person's drawers.

**Note the deliberate absence of an organisation test.** That absence *is* the merge. This directly replaces
the organisation test that the privacy-hardening pass adds in its item A5 — that check is correct under
today's single-plan model and is *replaced*, not deleted, here. Hardening A5 is therefore not wasted work,
but it is temporary, and this spec is where it gets superseded.

### 3.2 Everything else keeps today's behaviour

`client_ids_for_worker()`, `client_ids_for_org()` and the coordinator policies stay drawer-scoped, resolving
through the active context. A worker who works for both plans sees their assigned participants in whichever
plan is active — not a merged list — because a shift belongs to an employer.

`client_ids_for_therapist()` and the `note_shares` path need **no change at all**. Circle membership
attaches to a `clients` row (one drawer) and note sharing is a per-note grant by that drawer's
decision-maker, so a therapist invited by one plan accumulates only that plan's notes and a therapist
invited by both accumulates both. The existing implementation already matches the agreed model exactly.

### 3.3 The single most dangerous implementation error

Asking *"am I a coordinator?"* instead of *"am I a coordinator **in the active plan**?"*

Get that wrong anywhere and mum's family-plan coordinator status leaks her into The Friendship Circle's
staff-only records — precisely what §1 forbids. It is a one-word mistake with a cross-plan disclosure as
the consequence. Every rule needs the context-relative form, and §7 carries a probe specifically for it.

---

## 4. Linking two drawers safely

The sharpest risk in this design, and a different category of harm from everything else: every other leak
discussed is cross-*organisation* (someone seeing records they shouldn't in a business context). A wrong
participant link is cross-*household* — one family reading another family's private care records about
their disabled child.

The model narrows it usefully: **linking does not widen any provider's access.** Coordinators see only
their own drawer either way. The only thing a link changes is what the family and participant see. So no
provider-side consent negotiation is needed, and the entire safeguard reduces to one question: *are these
two drawers genuinely the same human?*

### 4.1 Rules

1. **No cross-tenant search, ever.** There must be no way — UI or API — to look up participants by name
   across plans. A searchable directory would itself be a privacy hole (it would let anyone probe whether a
   named person is a client of a given provider) and it is the *only* thing that makes name-collision
   mistakes possible. Removing the search removes the failure mode structurally, rather than warning people
   about it.
2. **Link by code, handed person to person.** The family member or participant in one drawer generates a
   single-use, expiring code. It travels through the human, not through a directory. Holding the code
   requires being, or being trusted by, the actual person. This mirrors the app's existing invite tokens.
3. **Only the participant or the decision-maker may initiate or redeem.** Never a coordinator or worker. A
   provider cannot quietly attach their client to another plan.
4. **Confirm before committing, disclosing the minimum.** Before the link completes, the redeemer sees
   first name and last initial, date of birth, and the name of the plan being linked — then confirms.
   Enough to catch a mismatch; nothing meaningful disclosed if they abort. `clients.dob` already exists, so
   no new sensitive field is needed. The app already shows *"Join &lt;Org&gt; as a &lt;Role&gt;"* before
   accepting an invite, so this pattern has precedent here.
   **Keep this step even when the same person is both sides.** "I'm obviously me" is exactly the assumption
   under which someone pastes the wrong code and confirms without reading.
5. **The NDIS participant number may confirm a link but must never authorise one.** That number appears on
   paperwork many people handle; knowing it must not be sufficient to reach someone's records.
6. **Reversible, and audited — because data cannot be un-seen.** Unlinking sets an end date rather than
   deleting, and every view during the linked window is recorded. If a wrong link occurs, the exposure has
   to be reconstructable precisely, both to tell the affected family and because it is a notifiable-breach
   conversation. This is the point where the audit gap noted in the hardening spec's Pass C stops being
   hygiene and becomes an obligation.
7. **No chaining.** Linking A↔B and B↔C must not silently merge A and C. Each link is an explicit,
   separately-confirmed pair.

### 4.2 Shape

```sql
create table companion.person_link_codes (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  source_client_id  uuid not null references companion.clients(id) on delete cascade,
  created_by        uuid not null references companion.profiles(id),
  expires_at        timestamptz not null,
  redeemed_at       timestamptz,
  redeemed_by       uuid references companion.profiles(id),
  target_client_id  uuid references companion.clients(id) on delete set null,
  created_at        timestamptz not null default now()
);

create table companion.person_links (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references companion.persons(id) on delete cascade,
  client_id      uuid not null references companion.clients(id) on delete cascade,
  linked_by      uuid references companion.profiles(id),
  linked_at      timestamptz not null default now(),
  unlinked_at    timestamptz,
  unlinked_by    uuid references companion.profiles(id),
  link_code_id   uuid references companion.person_link_codes(id)
);
```

`person_links` is the audit record of *why* a drawer belongs to a cabinet — `clients.person_id` is the live
pointer, this is its history. Unlinking sets `unlinked_at` and repoints `clients.person_id` at a fresh
`persons` row, so the drawer becomes its own cabinet again rather than being orphaned.

All writes are RPC-only, with the caller checks §4.1 rules 3 and 4 require. RLS enabled and explicit grants
on both tables — `060`'s default privileges make any bare `create table` in this schema world-writable to
`authenticated` until revoked.

---

## 5. Migration path

Additive first, cut over last, and at no point is the app broken mid-sequence.

1. **`persons` + `clients.person_id`**, backfilled 1:1. Zero behaviour change — a one-drawer cabinet behaves
   exactly as today.
2. **`profile_orgs`**, backfilled from `profiles.org_id`/`role`/`sub_role_id`. Still zero behaviour change;
   nothing reads it yet.
3. **Active-context plumbing** — `my_org_id()`/`my_role()` resolve via context, falling back to the single
   membership. For every current user, who has exactly one membership, this is a no-op by construction.
4. **Frontend**: plan switcher (hidden for single-plan users, i.e. everyone today), merged care view for
   family and participants, coordinator/worker surfaces bound to the active context.
5. **Person-scope the two read helpers** (§3.1). This is the first step with observable behaviour, and only
   for anyone who actually has a linked cabinet — nobody, until step 6 exists.
6. **Linking**: codes, confirmation, RPCs, audit.
7. **Cleanup**: `profiles.org_id`/`role`/`sub_role_id` dropped once no reader remains; `clients.person_id`
   made `not null`.

Steps 1–3 are invisible. Step 4 is visible but inert for single-plan users. The first genuinely new
capability is step 6.

---

## 6. What this does not change

- **Programs survives untouched.** A program belongs to one plan, so it subdivides a drawer rather than
  crossing drawers. Nothing in the Programs design assumes anything this spec invalidates.
- **The therapist path needs no work** (§3.2) — already correct.
- **All administrative surfaces keep today's single-plan assumption**, including everything built on
  2026-08-23 (sub-roles, permissions, members). They gain an active context; their logic is unchanged.
- **Provider-to-provider isolation is preserved and strengthened**, not relaxed. The merge is exclusively on
  person-side read paths.

---

## 7. Verification

Structural:
1. Every existing `clients` row has exactly one `persons` row after the backfill, and no two share one.
2. `profile_orgs` row count equals the count of profiles with a non-null `org_id`, and every role matches.
3. RLS enabled and no non-`SELECT` grants to `anon`/`authenticated` on `persons`, `profile_orgs`,
   `person_link_codes`, `person_links`.

Behavioural — direct API probes per role, with the `companion` schema header, because RLS is only proven
from outside the app:

4. **The context-leak probe (§3.3), the most important test here.** Mum is coordinator of the family plan
   and family in FC. With FC as the active context, she queries `notices` → **zero rows**. With the family
   plan active → her own plan's notices. If the first returns rows, role resolution is not
   context-relative and the model is broken.
5. **The merge works.** With two drawers linked, mum's merged care view returns journal entries from both.
   Sarah, logged in as the participant, likewise.
6. **The merge is bounded.** Mum sees no *notices* from either drawer in the merged view (participants and
   family never see notices), and nothing at all from a cabinet she isn't linked to.
7. **Staff do not merge.** A support worker employed by both plans, with FC active, sees only FC
   participants — never a merged list.
8. **Linking is authorised.** A coordinator attempting to redeem a link code → refused. A worker → refused.
9. **Linking is corroborated.** A code redeemed against the wrong plan still shows the confirmation
   payload (name initial, date of birth, plan name) and creates nothing until confirmed.
10. **Unlinking restores isolation.** After unlink, mum's merged view returns only her own plan's records,
    and `person_links` retains the historical row.
11. **Single-plan users are unaffected throughout.** Every probe above, run for the existing family org,
    returns exactly what it returned before any of this shipped.

---

## 8. Out of scope

- Several participants per one family (dropped for this pass, §1.1).
- Providers being able to discover that a participant is enrolled elsewhere — deliberately impossible.
- Merging *administrative* surfaces across plans; those stay per-plan by design.
- Programs, and the NDIS compliance/exports work — separate specs.
- The billing question of how a participant enrolled in two plans is counted. **Flagged, unresolved, and
  genuinely consequential:** today two drawers are two `clients` rows in two orgs and each plan bills for
  its own, which is almost certainly correct (both providers really are delivering a service). But it
  intersects the unresolved per-seat-versus-usage-meter question in `Companion-Gap-Report.md`, and must not
  be settled implicitly by whatever the linking code happens to do.

---

## 9. Residual risks

1. **§3.3 is the whole ballgame.** One non-context-relative role check produces a cross-plan disclosure.
   Probe 4 must run against every staff-visible table, not just `notices`.
2. **A wrong link is unrecoverable in the "un-see" sense.** Rule 6's audit is what turns it from an unknown
   exposure into a bounded, reportable one. It is not optional.
3. **`my_org_id()`/`my_role()` are being made context-dependent while remaining scalar.** That is what keeps
   the change small, and it is also a trapdoor: a future developer who assumes they are stable per session
   will write a subtly wrong rule. Worth a comment on both functions saying so.
4. **No live multi-plan user exists to test against.** Every probe runs against constructed test data —
   same caveat as the sub-role work, mitigated the same way (direct API probes, not UI inspection).
5. **The hardening pass's A5 is knowingly superseded here.** Sequencing them in the wrong order (this spec
   before hardening) would leave a detached family member with live access for longer than necessary.
