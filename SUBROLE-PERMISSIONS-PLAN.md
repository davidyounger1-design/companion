I verified every disputed claim against `E:\companion` before reconciling. Findings below are cited to what the repo actually contains.

---

# RECONCILIATION — what changed, and what the reviewers got wrong

## Reviewer findings I accepted (design changed)

| # | Finding | Verified how | Change made |
|---|---|---|---|
| 1 | **All five new tables would be world-writable** | `060_companion_schema.sql:54` — `alter default privileges in schema companion grant select, insert, update, delete on tables to authenticated;` A bare `create table companion.sub_roles(...)` inherits full CRUD for `authenticated`, and with RLS off PostgREST serves it. Post-060 convention (`063:33`, `064:33/90`, `065:26`) enables RLS immediately. | Every new table: `enable row level security`, `revoke all … from anon, authenticated`, then explicit `grant select` only. All writes RPC-only. Plus a post-deploy assertion over `pg_class.relrowsecurity`. **Also**: function `EXECUTE` defaults to `PUBLIC` in Postgres — every new function gets an explicit `revoke execute … from public`. Neither reviewer caught that second half. |
| 2 | **No authorization inside the new RPCs** | Design specified behaviour only. | Every RPC opens with `my_role()='coordinator'` **and** `org_id = my_org_id()` re-checked on every id argument, including the self-assignment path. |
| 3 | **`INVITE_MATRIX` has no `support_worker` key** | `invite-member/index.ts:60-64` verbatim — keys are `coordinator`, `family`, `trusted_support_worker` only; `allowed` is `undefined` → `!allowed` → 403. And `grep "on invites" migrations/*` returns only coordinator (`006:188`), family (`011:75`), trusted×2 (`012:91/102`) — **a plain `support_worker` has no `invites` RLS policy either**. The design's "verified effective truth" was wrong. | The `support_worker` seed row is **not** a grant any more. Invite breadth is split into two objects: `invite_ceiling` (per base role, seeded to today's backend exactly) and `sub_role_invitable_roles` (per sub-role, the actual grant, clamped to the ceiling). A plain worker's default sub-role has **zero** rows in the latter, so `invite_members: true` alone grants nothing. This closes the ops reviewer's F2 escalation *structurally* rather than by choosing a seed. |
| 4 | **`invite_members` cannot be a RESTRICTIVE key** | Correct — after `071` drops the two trusted policies, `support_worker` has no permissive INSERT on `invites` at all, so a restrictive policy can never admit the row. | Reclassified as `kind='grant'`. Its permissive INSERT + SELECT policies ship in **069** (additive; they admit nothing until 070 backfills), so there is *zero* window between the new path opening and the old one closing. `invite-member/index.ts` re-derives the permission server-side, because it runs as `service_role` and bypasses RLS. |
| 5 | **`remove_member` mints coordinator and leaves link rows** | `012:356` — `update profiles set org_id = null, role = 'coordinator'`. Still `public.remove_member`, `grant execute … to authenticated` (`012:362`), **not** in `060`'s `rpc_names` array (verified). | Rewritten in **069**: nulls `sub_role_id`, deletes `client_workers`/`client_family`/`client_circle` rows, stops minting `coordinator`. Plus `RESOLVE` step 2 now requires `org_id is not null` for the coordinator short-circuit — a detached profile resolves to **deny-all**, not ALLOW-ALL. |
| 6 | **Ship order was internally impossible** | `base_roles`' CHECK excludes `trusted_support_worker`, so the backfill's `profiles.sub_role_id` write FK-fails while `role` is still the retired string. | Transitional `base_roles` row + full `role_permission_defaults` set for `trusted_support_worker`, dropped in the cleanup step. |
| 7 | **FK landed 3 deploys before the RPCs that satisfy it** | Correct: `MATCH SIMPLE` hides it while `sub_role_id` is NULL everywhere, then all writers break the moment 070 lands. | FKs added `NOT VALID` in 068; **all six** SQL writers rewritten in 069; `VALIDATE` in 069; data moves only in 070. |
| 8 | **Four write paths missing from the design's list** | Verified all four: `create_organisation` (`047:65`), `setup_family_org` (`014:32`), `redeem-invite/index.ts:75-80` (upsert omits `sub_role_id`), `auto-register/index.ts:78`. | All enumerated and fixed. Also found a path **neither reviewer caught**: deleting an `organisation` cascade-deletes `sub_roles` while `profiles.org_id` is only `set null`, so `on delete restrict` on the profile FK would make **org deletion itself fail**. Added a `before delete on companion.organisations` trigger that nulls `sub_role_id` on that org's profiles and invites first. |
| 9 | `on update cascade` is a mass-role-change primitive | Multi-column cascade propagates into `profiles.org_id`/`profiles.role` — the two columns `047` exists to protect. | `on update restrict`. Immutability trigger kept as defence in depth, not as the only defence. |
| 10 | `edit_own_*` and `edit_any_*` collide on the same (table, cmd) | Correct and subtle: restrictive ANDs against the OR-union of permissive. | One restrictive policy **per (table, command)**, predicate = disjunction of every gate key governing that command. `permission_keys` now carries `target_table`/`target_cmd` so this is data-driven and assertable. |
| 11 | No DELETE key → edit restriction bypassable | `067:26` grants DELETE to `author_id = auth.uid()` unconditionally; `058:94` the same for goals. `add_entries` defaults true. Delete-and-relog defeats `edit_own_entry: false`. | Added `delete_own_entry` and `delete_own_goal`, seeded to **exactly** today's behaviour (day-one no-ops). Tables *not* governed by the vocabulary are listed explicitly in §4. |
| 12 | `permissions` jsonb has no value-type constraint | `'on'::boolean` inside a `stable security definer` function called from a policy = org-wide read failure with a cast error. | **Normalised**: `companion.sub_role_permissions(sub_role_id, permission_key, allowed boolean)`. Type system enforces the value, FK enforces the key, resolution becomes a left join. This also deletes the prose-vs-SQL disagreement over explicit JSON `null` that both reviewers spotted. |
| 13 | Resolution step 3a matched on `id` alone | Correct — the "unresolvable ⇒ treat as NULL" fail-safe covered *dangling* pointers, not a pointer that resolves cleanly to a **foreign org's** row. | Branch (a) now `and s.org_id is not distinct from me.org_id and s.base_role = me.role`; branch (b) guarded by `not exists`. |
| 14 | `has_perm` called `permissions_for` twice | Correct. | Single call, no `'*'` sentinel. |
| 15 | `sub_roles_allowed` / `kind` enforced nothing | Correct — both were `text`/`bool` columns nobody read. | Trigger enforces `sub_roles_allowed`; a `pg_policies` assertion enforces `kind` (gate ⇒ RESTRICTIVE, grant ⇒ PERMISSIVE) **and** catches a typo'd key and any bare (un-`(select …)`-wrapped) call. |
| 16 | Coordinator return shape `{"*":true}` breaks the app contract | Correct — `perms.add_goals` would be `undefined` for coordinators. | `permissions_for` expands the full key set to `true` for coordinators. No sentinel anywhere. |
| 17 | Idempotency asserted, not implemented | Correct: no `on conflict`, and there is no `add constraint if not exists`. | `on conflict … do update` on catalogues, `where not exists` on the backfill, `do $$ … pg_constraint … $$` guards for every named constraint, `drop policy if exists` before every create, `drop trigger if exists`, explicit `begin;`/`commit;` per migration. |
| 18 | No rollback; inspect 0.7 captured too little to recreate dropped policies | Correct — `policyname` alone can't rebuild a policy. | Inspect block now dumps `pg_get_expr(polqual…)`, `pg_get_expr(polwithcheck…)`, `polcmd`, `polpermissive`, `polroles`. Explicit down-migration per step; `profiles.sub_role_id` named as the recovery key; the `org_settings.permissions` drop named as the irreversibility boundary. |
| 19 | Frontend-before-migration locks out coordinators too | Correct, and it's the *likely* order since the frontend leg is automated. | Client keeps an unconditional `role === 'coordinator' → ALLOW_ALL` short-circuit **before** the query; `isError` distinguished from `isLoading`; `PGRST202` falls back to the legacy `org_settings` path. |
| 20 | Stale PWA clients ⇒ unbounded dual-permission-system window | `sw.ts:20-23` calls `skipWaiting()` **only** on a message; `UpdatePrompt` requires a user tap. `App.tsx:57-62`'s comment claiming silent updates is stale and contradicts both files. | Added a **forward-compat shim**: a `security definer` trigger on `companion.org_settings` that translates a legacy `permissions` write into the corresponding default sub-roles' `sub_role_permissions`, clamped by `max_allowed`. Stale clients' admin saves keep working instead of becoming silent no-ops. Removes the pressure to rush cleanup. |
| 21 | `PermissionsPage` materialises defaults, so "which org toggled something off" is unanswerable | `PermissionsPage.tsx:100` `merged[key] = { ...DEFAULT_PERMS[key], ...(storedPerms[key] ?? {}) }`, saved wholesale at `:126`. After any Save, all 9 keys × all configurable roles are explicit. | The inspect query now asks **"which stored value differs from the default"**, not "which is false". The backfill records **only differences** from `role_permission_defaults`, so "absent key ⇒ default" keeps meaning something. |
| 22 | The mint path stays open across the gap | Correct: `promote_member` still accepts the retired value until the flip, and stale clients still show `↑ Trust`. | `promote_member` is rewritten in **069**, *before* any data moves — it returns `{ok:false,error}`, not an exception, so stale clients get a clean message. 071 re-asserts + catch-up-backfills in the same transaction, behind a human attestation row in `companion.migration_gates`. |
| 23 | In-flight write denial on bridge deploy | Real, and in a care-notes app it's clinical-record loss. | Every bridged key: counting dry-run → frontend disabled-state deploy → *then* the policy. Never the reverse. |
| 24 | `public.has_perm` is a collision-prone name in a shared project | `060`'s stated reason for leaving helpers in `public` was "moving them would mean re-editing every policy for no benefit" — an argument against moving existing ones, not for adding new ones. | New helper is `companion.has_perm(text)`. Policy bodies can reference any schema regardless of the client's `db.schema` pin; only `my_permissions()` genuinely must live in `companion` (PostgREST resolves `rpc/` inside the pinned schema). |

## Reviewer findings that are wrong — with the defence

**A. "`view_all_entries` is the mass-revoke bomb" (security review, HIGH) — factually wrong.**
The claim rests on `"workers can view logs for assigned clients"` being live with no author test. It is not live. `011_family_plan.sql:7-15`, under the header `-- ── 1. Fix support_worker log visibility: own entries only ───`, drops it and replaces it with `"workers can view own log entries"` using `author_id = auth.uid()`; `012:56` refines that. `grep -rn "workers can view logs for assigned clients" supabase/migrations/` returns exactly three hits: `003:26` (drop), `003:37` (create), `006:129/139` (drop+create), `011:7` (drop) — **nothing recreates it**. The cited `013:167` is an **INSERT** policy, not SELECT. Live `log_entries` SELECT policies are: coordinator-by-org (`006:145`), worker-own-only (`012:56`), family (`013:174`), recipient (`030:13`). So `DEFAULT_PERMS.support_worker.view_all_entries = false` **matches live RLS exactly**. No revoke exists here.
The reviewer's *method* — build the default × live-RLS matrix before writing any policy — is right and I adopted it. It is now §2's inspect block, and it found exactly **one** narrowing cell (see B).

**B. "`send_messages` silently removes messaging from every care recipient" (security review, HIGH) — half wrong, and the important half.**
The RLS fact is right: `006:177-182` is `with check (sender_id = auth.uid() and org_id = public.my_org_id())`, no role test, and it is the only INSERT policy on `messages`. `DEFAULT_PERMS.recipient.send_messages = false` (`usePermissions.ts:89`). But `FamilyBottomNav.tsx:25` is `const showMessages = !isRecipient && has(FEATURES.messaging)`, with the comment "*Recipients don't have a messaging inbox*". Recipients have **no messaging nav entry at all**. So the gate aligns RLS with a restriction the product already intends and the UI already enforces; it removes no reachable capability. It is still a real API-surface change and it stays in the announce list — but not as "removes messaging from the most vulnerable user group".

**C. "`remove_member` → cross-tenant journal read" (security review, HIGH) — right conclusion, wrong mechanism, and the real one is worse.**
The `remove_member` facts all check out (see accepted #5). But the asserted leak runs through the same dropped policy as (A): with `org_id` NULL and `my_role()='coordinator'`, **none** of the four live `log_entries` SELECT policies match, so a detached ex-worker sees no journal entries. The finding survives in a narrower and nastier form: `clients` SELECT (`013:91`, `id in (select public.client_ids_for_worker())`) and **`behaviour_notes` SELECT/UPDATE** (`013:210/214`) have *no role test and no org test*, and `client_ids_for_worker()` (`013:29-31`) has no org test either. So the residue is participant records and **behaviour notes** — the clinical-sensitive tables — not journals. Both fixes ship: `remove_member` cleans link rows, and `client_ids_for_worker()` gains an org join.

**D. The design's own `INVITE_MATRIX` claim** — wrong, as both reviewers said. Verified above.

**E. The design's "four permissive INSERT policies on `log_entries`"** — it is **five**: `013:167`, `013:179`, `013:188`, `030:18`, `056:15`. The enumeration is load-bearing for the restrictive-policy argument, so the correction matters.

---

# 1. DECISIONS THE PRODUCT OWNER MUST MAKE

Five. Everything else is pre-wired with a defensible default; these five change the outcome and must not be guessed. The SQL has a single **`PO DIALS`** block at the top of `068` — change it there, nowhere else.

**D1. Ceiling for `edit_any_entry` on `support_worker`.** Recommend **`false`** — editing a colleague's clinical record is a coordinator act, and there is no RLS path for it today. Setting it `true` makes "Senior worker can edit anyone's entries" expressible; it also means a coordinator toggle can hand out clinical-record edit rights. *Pre-wired: `false`.*

**D2. Which base roles may have sub-roles at all** (`base_roles.sub_roles_allowed`). Recommend **`support_worker` only** for this pass. `family` is the obvious second, but family defaults already grant `view_all_entries` + `edit_any_entry`, so a family sub-role is a wider blast radius for no current requirement. *Pre-wired: `support_worker` true, all others false.*

**D3. `view_all_entries` for a worker sub-role means "all entries for participants assigned to me, authored by anyone" — never org-wide.** Confirm. It is the only reading compatible with the assignment ceiling, and it is a genuine **new grant** (today a worker sees only their own entries — see defence A). Ceiling pre-wired `true`, default `false`, so nothing changes until a coordinator ticks it on a named sub-role.

**D4. Was the trusted worker's invite ability ever actually exercised?** Verified: `WorkerLayout` has no Members link; the only three `/members` links are `App.tsx:252` (route), `FamilyHeader.tsx:71` (inside a coordinator gate), `CoordinatorDashboard.tsx:204`. The capability has only ever been reachable by typing the URL. If never used, `070` should create the "Trusted worker" sub-role but **leave it unassigned** — strictly simpler, strictly safer, and it makes `071` a pure no-op for those users. *Pre-wired: assign it (the conservative-for-parity choice). Flip `po_assign_trusted` to `false` in the dials block if the answer is "never used".*

**D5. Orgs whose stored `org_settings.permissions` differs from the defaults.** Inspect query **I6** lists them. Because `PermissionsPage.tsx:100/126` materialises all nine keys on every Save, a stored `false` is usually just a saved default — but a stored value that *differs* from the default is real intent. Decide **before running `070`**: honour those differences (the backfill carries them into `sub_role_permissions`) or reset them and let coordinators re-apply deliberately. Recommend **honour the differences, reset nothing** — the matrix in §2 shows only one narrowing cell platform-wide, so honouring is cheap. *Pre-wired: honour.*

Not a decision, but a disclosure the PO should sign off on: **five cells of the permission matrix are decorative and will stay decorative after this pass** — `therapist.view_all_entries`, `therapist.add_goals`, `therapist.edit_own_goal`, `therapist.delete_own_goal` (a therapist has *no* policy on `log_entries` or `participant_goals` at all — verified by full policy enumeration), and `family.edit_any_entry` (`067:15` allows only `author_id = auth.uid()` or coordinator). Bridging any of them as a permissive policy would be a **new grant**, not enforcement, so this pass deliberately does not. The UI must stop showing them as switches, or the switches must be labelled as not-yet-enforced. See §4.

---

# 2. THE COMPLETE MIGRATION SQL

## INSPECT FIRST — read-only, run all of it, keep the output

Nothing below changes anything. Run it before `068` and keep the results — `I7`/`I8`/`I9` are the only record from which the destructive steps can be reversed.

```sql
-- ═══════════════════════════════════════════════════════════════════
-- INSPECT-ONLY. Zero writes. Run every block; save the output.
-- ═══════════════════════════════════════════════════════════════════

-- I1 · Does the untracked column exist? No migration ever created
--      org_settings.permissions (grep over all 67 files: zero hits).
select column_name, data_type, is_nullable, column_default
from   information_schema.columns
where  table_schema = 'companion' and table_name = 'org_settings'
order  by ordinal_position;

-- I2 · Live CHECK constraints. Trust these over the migration history.
select c.conrelid::regclass as tbl, c.conname, pg_get_constraintdef(c.oid)
from   pg_constraint c
where  c.conrelid in ('companion.profiles'::regclass, 'companion.invites'::regclass)
  and  c.contype = 'c'
order  by 1, 2;

-- I3 · Do the default privileges from 060:54 actually apply here?
--      If this returns a row granting arudx to `authenticated`, every new
--      table in 068 would be world-writable without the explicit revokes.
--      If it returns NOTHING, the revokes are harmless and the grants in
--      068 are what make the UI able to read the catalogue. Either way 068
--      is correct — this tells you which failure you were one paste away from.
select defaclrole::regrole as granted_by, defaclobjtype, defaclacl
from   pg_default_acl
where  defaclnamespace = 'companion'::regnamespace;

-- I4 · Who is affected, per org, plus the client access that is
--      assignment-based and survives untouched.
select o.id as org_id, o.name, o.org_type, o.plan, o.billing_status,
       p.id as profile_id, p.full_name,
       (select count(*) from companion.client_workers cw where cw.worker_id = p.id)
         as assigned_clients
from   companion.profiles p
join   companion.organisations o on o.id = p.org_id
where  p.role = 'trusted_support_worker'
order  by o.name, p.full_name;

-- I5 · Pending invites are the live hazard: accept_invite (041:58-60) and
--      redeem-invite (index.ts:73-80) both copy invites.role into
--      profiles.role, re-minting the retired value after any flip.
select id, org_id, email, status, expires_at, client_id
from   companion.invites
where  role = 'trusted_support_worker'
order  by (status = 'pending') desc, expires_at desc;

-- I6 · THE DECISION QUERY (PO decision D5).
--      NOT "which org toggled something off" — PermissionsPage.tsx:100
--      materialises every default on every Save, so a stored `false` is
--      usually just a saved default. This lists only stored values that
--      DIFFER from the hardcoded default, i.e. actual coordinator intent.
--      Self-contained (inline defaults) so it runs before 068.
with defaults(base_role, k, v) as (values
  ('family','view_all_entries',true),('family','edit_any_entry',true),
  ('family','edit_own_entry',true),('family','add_entries',true),
  ('family','send_messages',true),('family','invite_members',true),
  ('family','add_goals',true),('family','edit_own_goal',true),
  ('family','edit_any_goal',true),
  ('trusted_support_worker','view_all_entries',false),('trusted_support_worker','edit_any_entry',false),
  ('trusted_support_worker','edit_own_entry',true),('trusted_support_worker','add_entries',true),
  ('trusted_support_worker','send_messages',true),('trusted_support_worker','invite_members',true),
  ('trusted_support_worker','add_goals',true),('trusted_support_worker','edit_own_goal',true),
  ('trusted_support_worker','edit_any_goal',false),
  ('support_worker','view_all_entries',false),('support_worker','edit_any_entry',false),
  ('support_worker','edit_own_entry',true),('support_worker','add_entries',true),
  ('support_worker','send_messages',true),('support_worker','invite_members',false),
  ('support_worker','add_goals',true),('support_worker','edit_own_goal',true),
  ('support_worker','edit_any_goal',false),
  ('therapist','view_all_entries',true),('therapist','edit_any_entry',false),
  ('therapist','edit_own_entry',false),('therapist','add_entries',false),
  ('therapist','send_messages',true),('therapist','invite_members',false),
  ('therapist','add_goals',true),('therapist','edit_own_goal',true),
  ('therapist','edit_any_goal',false),
  ('recipient','view_all_entries',true),('recipient','edit_any_entry',false),
  ('recipient','edit_own_entry',true),('recipient','add_entries',true),
  ('recipient','send_messages',false),('recipient','invite_members',false),
  ('recipient','add_goals',true),('recipient','edit_own_goal',true),
  ('recipient','edit_any_goal',false)
)
select os.org_id, r.role_key, kv.key, kv.value as stored, d.v as default_value
from   companion.org_settings os
cross  join lateral jsonb_each(coalesce(os.permissions,'{}'::jsonb)) as r(role_key, perms)
cross  join lateral jsonb_each(r.perms)                              as kv(key, value)
left   join defaults d on d.base_role = r.role_key and d.k = kv.key
where  d.v is null                                  -- unknown role or key
   or  kv.value <> to_jsonb(d.v)                    -- real divergence
order  by 1,2,3;

-- I7 · FULL policy definitions for every table this project touches.
--      polqual/polwithcheck are what 071 destroys; policyname alone
--      cannot rebuild them. This is the rollback record.
select n.nspname, c.relname, pol.polname,
       pol.polcmd,
       pol.polpermissive,
       pg_get_expr(pol.polqual,      pol.polrelid) as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr,
       (select array_agg(r.rolname order by r.rolname)
          from pg_roles r where r.oid = any(pol.polroles)) as roles
from   pg_policy pol
join   pg_class     c on c.oid = pol.polrelid
join   pg_namespace n on n.oid = c.relnamespace
where  (n.nspname, c.relname) in (
         ('companion','log_entries'), ('companion','messages'),
         ('companion','invites'),     ('companion','participant_goals'),
         ('companion','profiles'),    ('companion','org_settings'),
         ('companion','clients'),     ('companion','behaviour_notes'),
         ('storage','objects'))
order  by 1,2,3;

-- I8 · Live objects still mentioning the retired role. Anything here that
--      is not in the migration files is untracked drift.
select schemaname, tablename, policyname
from   pg_policies
where  coalesce(qual,'') || coalesce(with_check,'') like '%trusted_support_worker%'
order  by 1,2,3;

-- I9 · Capture the LIVE bodies you will rewrite. Do NOT reconstruct from
--      migration text: 060's sweep (lines 105-160) rewrote table refs to
--      companion.* and search_path to 'companion','public', so the files no
--      longer match what is deployed.
select n.nspname, p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  (n.nspname, p.proname) in (
         ('companion','accept_invite'),   ('companion','promote_member'),
         ('companion','demote_member'),   ('companion','create_organisation'),
         ('companion','setup_family_org'),('companion','get_org_members'),
         ('public','remove_member'),      ('public','can_view_log_entry'),
         ('public','client_ids_for_worker'));

-- I10 · Confirm remove_member is still callable by end users. It sets
--       role='coordinator', org_id=NULL and is absent from 060's rpc_names
--       array, so it lives in `public` and is reachable with a
--       Content-Profile: public header even though the app's client is
--       schema-pinned to companion.
select p.oid::regprocedure as fn, p.proacl
from   pg_proc p join pg_namespace n on n.oid = p.pronamespace
where  n.nspname = 'public' and p.proname = 'remove_member';
```

### The default × live-RLS matrix (already derived — do not re-derive, verify)

This is the artifact both reviewers demanded, built from a full policy enumeration. `D` = hardcoded default in `usePermissions.ts`; `RLS` = what live policy actually permits.

| key | table.cmd | coordinator | family | support_worker | therapist | recipient |
|---|---|---|---|---|---|---|
| `add_entries` | log_entries INS | T/T `056:15` | T/T `013:179` | T/T `013:167` | F/none | T/T `030:18` |
| `view_all_entries` | log_entries SEL | T/T `006:145` | T/T `013:174` | F/F `012:56` | **T / none** ⚠ | T/T `030:14` |
| `edit_own_entry` | log_entries UPD | T/T `067:15` | T/T | T/T | F/none | T/T |
| `edit_any_entry` | log_entries UPD | T/T `067:15` | **T / none** ⚠ | F/F | F/F | F/F |
| `delete_own_entry` *(new)* | log_entries DEL | T/T `023:8`,`067:26` | T/T `023:15` | T/T `067:26` | F/none | T/T |
| `send_messages` | messages INS | T/T | T/T | T/T | T/T | **F / T** ⚠️**narrowing** |
| `invite_members` | invites INS | T/T `006:188` | T/T `011:75` | F/F *(no policy)* | F/F | F/F |
| `add_goals` | goals INS | T/T `058:45` | T/T | T/T | **T / none** ⚠ | T/T |
| `edit_own_goal` | goals UPD | T/T `058:57` | T/T `058:65` | T/T `058:87` | **T / none** ⚠ | T/T `058:73` |
| `edit_any_goal` | goals UPD | T/T | T/T `058:65` | F/F | F/F | F/F |
| `delete_own_goal` *(new)* | goals DEL | T/T `058:61` | T/T `058:69` | T/T `058:94` | **T / none** ⚠ | T/T `058:80` |
| *(`trusted_support_worker`)* | invites INS | — | — | T/T `012:91` | — | — |

**⚠ = default is more permissive than live RLS.** Bridging any of these as a *permissive* policy is a new grant, not enforcement. This pass does not.
**⚠️ = the only narrowing on the platform**, and it has no UI path (`FamilyBottomNav.tsx:25`).

---

## `068_sub_roles_infrastructure.sql` — additive only, zero behaviour change

```sql
-- ═══════════════════════════════════════════════════════════════════
-- 068 · Sub-role & permission-resolution infrastructure  (idempotent)
--
-- ADDITIVE ONLY. Creates the vocabulary, the sub-role tables, the
-- resolution functions and the management RPCs. Changes NO existing
-- policy, NO existing constraint, and NO existing row. Nothing in the
-- app reads any of it yet.
--
-- Every table is schema-qualified `companion.*`; every function pins
-- `search_path = ''` and fully qualifies every reference, so an
-- unqualified name errors loudly instead of resolving through whatever
-- happens to be visible. (This repo has been bitten twice: 062 failed
-- because the SQL editor's search_path is `public`; 060 needed a regex
-- fallback for client_ids_for_recipient()'s bare `from clients`.)
--
-- RLS + explicit grants are NOT optional here. 060:54 sets
--   alter default privileges in schema companion
--     grant select, insert, update, delete on tables to authenticated;
-- so a bare `create table` in this schema is world-writable, and
-- Postgres grants EXECUTE on new functions to PUBLIC by default.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────────────────────────────────────────────────────────────
-- PO DIALS · the only block you should edit. Everything downstream
--            reads these. See §1 of the plan for the rationale.
-- ───────────────────────────────────────────────────────────────────
create table if not exists companion.migration_gates (
  gate     text primary key,
  noted_at timestamptz not null default now(),
  note     text
);
alter table companion.migration_gates enable row level security;
revoke all on table companion.migration_gates from anon, authenticated;

--   D1  ceiling_sw_edit_any_entry   = false   (recommended)
--   D2  sub_roles_allowed           = support_worker only
--   D3  ceiling_sw_view_all_entries = true    (default stays false)
--   D4  po_assign_trusted           = true    (flip to false if the
--                                              invite ability was never used)
--   D5  honour stored divergences   = true    (see 070)

-- ═══ 1 · CATALOGUE: base roles ═════════════════════════════════════
create table if not exists companion.base_roles (
  role              text primary key,
  label             text    not null,
  sub_roles_allowed boolean not null default false,
  is_transitional   boolean not null default false,
  sort_order        int     not null default 0
);

insert into companion.base_roles (role, label, sub_roles_allowed, is_transitional, sort_order) values
  ('coordinator',            'Coordinator',    false, false, 10),
  ('family',                 'Family member',  false, false, 20),  -- D2
  ('recipient',              'Care recipient', false, false, 30),
  ('support_worker',         'Support worker',  true, false, 40),   -- D2
  ('therapist',              'Therapist',      false, false, 50),
  -- TRANSITIONAL. Exists only so 070 can point a still-'trusted' profile
  -- at a sub-role without violating the composite FK, and so the invite
  -- ceiling can keep serving those users until 071 flips them.
  -- Removed in the cleanup migration.
  ('trusted_support_worker', 'Trusted worker', false,  true, 45)
on conflict (role) do update
  set label = excluded.label,
      sub_roles_allowed = excluded.sub_roles_allowed,
      is_transitional   = excluded.is_transitional,
      sort_order        = excluded.sort_order;

-- ═══ 2 · CATALOGUE: the permission vocabulary ══════════════════════
-- kind:
--   'gate'  — can only NARROW an existing capability. Enforced by a
--             RESTRICTIVE policy, which Postgres ANDs against the
--             OR-union of all permissive policies, so it can only ever
--             remove rows. A gate toggle physically cannot widen scope.
--   'grant' — ADMITS rows the base role otherwise cannot reach.
--             Enforced by a PERMISSIVE policy whose structural ceiling
--             term (an assignment table) is unconditional.
-- target_table/target_cmd make the restrictive-disjunction grouping and
-- the §5 assertion queries data-driven instead of hand-audited.
create table if not exists companion.permission_keys (
  key          text primary key,
  label        text not null,
  description  text,
  kind         text not null check (kind in ('gate','grant')),
  target_table text not null,
  target_cmd   text not null check (target_cmd in ('SELECT','INSERT','UPDATE','DELETE')),
  enforced     boolean not null default false,   -- flipped true when its policy ships
  sort_order   int not null default 0
);

insert into companion.permission_keys
  (key, label, description, kind, target_table, target_cmd, sort_order) values
  ('add_entries',      'Add journal entries',      'Can log new meal, activity, mood and note entries',        'gate',  'log_entries',      'INSERT', 10),
  ('view_all_entries', 'View all entries',         'Can see entries logged by other team members for the participants they are assigned to', 'grant', 'log_entries', 'SELECT', 20),
  ('edit_own_entry',   'Edit own entries',         'Can edit entries they personally logged',                   'gate',  'log_entries',      'UPDATE', 30),
  ('edit_any_entry',   'Edit anyone''s entries',   'Can edit entries logged by any team member',                'grant', 'log_entries',      'UPDATE', 40),
  ('delete_own_entry', 'Delete own entries',       'Can delete entries they personally logged',                 'gate',  'log_entries',      'DELETE', 50),
  ('send_messages',    'Send messages',            'Can send direct messages to other members',                 'gate',  'messages',         'INSERT', 60),
  ('invite_members',   'Invite members',           'Can send invitations, for the roles their sub-role allows',  'grant', 'invites',          'INSERT', 70),
  ('add_goals',        'Add goals',                'Can set a new NDIS goal for a connected participant',       'gate',  'participant_goals','INSERT', 80),
  ('edit_own_goal',    'Edit own goals',           'Can edit or discontinue a goal they created',               'gate',  'participant_goals','UPDATE', 90),
  ('edit_any_goal',    'Edit anyone''s goals',     'Can edit or discontinue a goal created by any team member',  'grant', 'participant_goals','UPDATE', 100),
  ('delete_own_goal',  'Delete own goals',         'Can delete a goal they created',                            'gate',  'participant_goals','DELETE', 110)
on conflict (key) do update
  set label = excluded.label, description = excluded.description,
      kind  = excluded.kind,  target_table = excluded.target_table,
      target_cmd = excluded.target_cmd, sort_order = excluded.sort_order;

-- ═══ 3 · CATALOGUE: defaults + ceilings ════════════════════════════
-- default_allowed = what a sub-role starts at / falls back to.
--                   Seeded to DEFAULT_PERMS in usePermissions.ts:39-95
--                   EXACTLY, plus the two new delete keys seeded to
--                   exactly what live RLS already permits (023, 058,
--                   067) — so they are day-one no-ops.
-- max_allowed     = the CEILING. No sub-role of this base role may
--                   exceed it. Clamped at READ time (so a row written
--                   by hand in the SQL editor or by a service-role edge
--                   function still cannot escalate) AND at write time.
create table if not exists companion.role_permission_defaults (
  base_role       text    not null references companion.base_roles(role)      on delete cascade,
  permission_key  text    not null references companion.permission_keys(key)  on delete cascade,
  default_allowed boolean not null,
  max_allowed     boolean not null,
  primary key (base_role, permission_key),
  constraint rpd_default_within_ceiling check (max_allowed or not default_allowed)
);

insert into companion.role_permission_defaults
  (base_role, permission_key, default_allowed, max_allowed) values
  -- coordinator: short-circuited in resolution, seeded for completeness only
  ('coordinator','add_entries',      true, true), ('coordinator','view_all_entries', true, true),
  ('coordinator','edit_own_entry',   true, true), ('coordinator','edit_any_entry',   true, true),
  ('coordinator','delete_own_entry', true, true), ('coordinator','send_messages',    true, true),
  ('coordinator','invite_members',   true, true), ('coordinator','add_goals',        true, true),
  ('coordinator','edit_own_goal',    true, true), ('coordinator','edit_any_goal',    true, true),
  ('coordinator','delete_own_goal',  true, true),
  -- family
  ('family','add_entries',      true, true), ('family','view_all_entries', true, true),
  ('family','edit_own_entry',   true, true), ('family','edit_any_entry',   true, true),
  ('family','delete_own_entry', true, true), ('family','send_messages',    true, true),
  ('family','invite_members',   true, true), ('family','add_goals',        true, true),
  ('family','edit_own_goal',    true, true), ('family','edit_any_goal',    true, true),
  ('family','delete_own_goal',  true, true),
  -- support_worker  ── the ceilings that matter (D1, D3)
  ('support_worker','add_entries',      true,  true),
  ('support_worker','view_all_entries', false, true),   -- D3: grantable, off by default
  ('support_worker','edit_own_entry',   true,  true),
  ('support_worker','edit_any_entry',   false, false),  -- D1: hard no
  ('support_worker','delete_own_entry', true,  true),
  ('support_worker','send_messages',    true,  true),
  ('support_worker','invite_members',   false, true),   -- what makes "Trusted worker" expressible
  ('support_worker','add_goals',        true,  true),
  ('support_worker','edit_own_goal',    true,  true),
  ('support_worker','edit_any_goal',    false, true),
  ('support_worker','delete_own_goal',  true,  true),
  -- therapist: ceilings == defaults (no sub-roles, D2)
  ('therapist','add_entries',      false,false), ('therapist','view_all_entries', true, true),
  ('therapist','edit_own_entry',   false,false), ('therapist','edit_any_entry',   false,false),
  ('therapist','delete_own_entry', false,false), ('therapist','send_messages',    true, true),
  ('therapist','invite_members',   false,false), ('therapist','add_goals',        true, true),
  ('therapist','edit_own_goal',    true, true),  ('therapist','edit_any_goal',    false,false),
  ('therapist','delete_own_goal',  true, true),
  -- recipient: ceilings == defaults
  ('recipient','add_entries',      true, true),  ('recipient','view_all_entries', true, true),
  ('recipient','edit_own_entry',   true, true),  ('recipient','edit_any_entry',   false,false),
  ('recipient','delete_own_entry', true, true),  ('recipient','send_messages',    false,false),
  ('recipient','invite_members',   false,false), ('recipient','add_goals',        true, true),
  ('recipient','edit_own_goal',    true, true),  ('recipient','edit_any_goal',    false,false),
  ('recipient','delete_own_goal',  true, true),
  -- TRANSITIONAL trusted_support_worker: byte-identical to support_worker
  -- except invite_members. Removed in cleanup.
  ('trusted_support_worker','add_entries',      true,  true),
  ('trusted_support_worker','view_all_entries', false, true),
  ('trusted_support_worker','edit_own_entry',   true,  true),
  ('trusted_support_worker','edit_any_entry',   false, false),
  ('trusted_support_worker','delete_own_entry', true,  true),
  ('trusted_support_worker','send_messages',    true,  true),
  ('trusted_support_worker','invite_members',   true,  true),
  ('trusted_support_worker','add_goals',        true,  true),
  ('trusted_support_worker','edit_own_goal',    true,  true),
  ('trusted_support_worker','edit_any_goal',    false, true),
  ('trusted_support_worker','delete_own_goal',  true,  true)
on conflict (base_role, permission_key) do update
  set default_allowed = excluded.default_allowed,
      max_allowed     = excluded.max_allowed;

-- ═══ 4 · CATALOGUE: invite ceiling ═════════════════════════════════
-- The CEILING, not the grant. Seeded to exactly the backend's current
-- behaviour (invite-member/index.ts:60-64) — which has NO support_worker
-- key: a plain worker with invite_members ON has always received a 403.
-- The `support_worker` rows below are therefore a CEILING ONLY. The
-- actual grant is companion.sub_role_invitable_roles, which is EMPTY for
-- every default sub-role, so no plain worker gains anything even in an
-- org where a coordinator ticked `invite_members` on.
create table if not exists companion.invite_ceiling (
  caller_base_role text not null references companion.base_roles(role) on delete cascade,
  invitable_role   text not null references companion.base_roles(role) on delete cascade,
  primary key (caller_base_role, invitable_role)
);

insert into companion.invite_ceiling (caller_base_role, invitable_role) values
  ('coordinator','coordinator'),  ('coordinator','family'),
  ('coordinator','recipient'),    ('coordinator','support_worker'),
  ('coordinator','therapist'),    ('coordinator','trusted_support_worker'), -- transitional
  ('family','family'),            ('family','recipient'),
  ('family','support_worker'),    ('family','therapist'),
  ('family','trusted_support_worker'),                                      -- transitional
  ('trusted_support_worker','support_worker'),                              -- transitional
  ('support_worker','support_worker')            -- CEILING ONLY, see comment above
on conflict do nothing;

-- ═══ 5 · SUB-ROLES ═════════════════════════════════════════════════
create table if not exists companion.sub_roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references companion.organisations(id) on delete cascade,
  base_role   text not null references companion.base_roles(role),
  name        text not null,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_by  uuid references companion.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A coordinator sub-role is forbidden: resolution short-circuits on
  -- coordinator in ~30 code sites, and a restricted coordinator can lock
  -- an org out of its own settings page.
  constraint sub_roles_no_coordinator check (base_role <> 'coordinator'),
  constraint sub_roles_name_len       check (char_length(btrim(name)) between 1 and 40),
  -- Makes the composite FK possible: closes cross-tenant AND
  -- cross-base-role assignment declaratively, not by RPC discipline.
  constraint sub_roles_id_org_role_uk unique (id, org_id, base_role)
);

create unique index if not exists sub_roles_org_role_name_uk
  on companion.sub_roles (org_id, base_role, lower(btrim(name))) where archived_at is null;
create unique index if not exists sub_roles_one_default_uk
  on companion.sub_roles (org_id, base_role) where is_default;
create index if not exists sub_roles_org_role_idx
  on companion.sub_roles (org_id, base_role) where archived_at is null;

create table if not exists companion.sub_role_permissions (
  sub_role_id    uuid    not null references companion.sub_roles(id)         on delete cascade,
  permission_key text    not null references companion.permission_keys(key)  on delete cascade,
  allowed        boolean not null,
  primary key (sub_role_id, permission_key)
);

create table if not exists companion.sub_role_invitable_roles (
  sub_role_id    uuid not null references companion.sub_roles(id)      on delete cascade,
  invitable_role text not null references companion.base_roles(role)   on delete cascade,
  primary key (sub_role_id, invitable_role)
);

-- ═══ 6 · profiles / invites reference columns + composite FKs ══════
alter table companion.profiles add column if not exists sub_role_id uuid;
alter table companion.invites  add column if not exists sub_role_id uuid;

create index if not exists profiles_sub_role_idx on companion.profiles (sub_role_id);
create index if not exists invites_sub_role_idx  on companion.invites  (sub_role_id);

-- NOT VALID: no existing row has a non-null sub_role_id, so there is
-- nothing to scan, and 069 (which fixes every writer) VALIDATEs them.
--   * ON DELETE RESTRICT, not SET NULL: a multi-column SET NULL nulls
--     EVERY referencing column — it would wipe org_id and role off the
--     profile. The column-list form is PG15+ and depending on it
--     silently is exactly the class of assumption to avoid here.
--   * ON UPDATE RESTRICT, not CASCADE: multi-column cascade propagates
--     an UPDATE of sub_roles.org_id into profiles.org_id and of
--     base_role into profiles.role — a one-statement cross-tenant move
--     or self-promotion, bypassing every promote_member guard. There is
--     no legitimate cascade: both columns are immutable by trigger.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'profiles_sub_role_fk'
                   and conrelid = 'companion.profiles'::regclass) then
    alter table companion.profiles
      add constraint profiles_sub_role_fk
      foreign key (sub_role_id, org_id, role)
      references companion.sub_roles (id, org_id, base_role)
      on delete restrict on update restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'invites_sub_role_fk'
                   and conrelid = 'companion.invites'::regclass) then
    alter table companion.invites
      add constraint invites_sub_role_fk
      foreign key (sub_role_id, org_id, role)
      references companion.sub_roles (id, org_id, base_role)
      on delete restrict on update restrict not valid;
  end if;
end $$;

-- NOTE, deliberately not fixed by a grant: sub_role_id joins role and
-- org_id as RPC-only. 047 revoked column UPDATE for `authenticated` and
-- granted only (full_name, phone). There is no
--   grant update (sub_role_id) ...
-- anywhere in this plan, and there must never be one.

-- ═══ 7 · RLS + GRANTS · load-bearing, see header ═══════════════════
alter table companion.base_roles               enable row level security;
alter table companion.permission_keys          enable row level security;
alter table companion.role_permission_defaults enable row level security;
alter table companion.invite_ceiling           enable row level security;
alter table companion.sub_roles                enable row level security;
alter table companion.sub_role_permissions     enable row level security;
alter table companion.sub_role_invitable_roles enable row level security;

revoke all on table companion.base_roles,
                    companion.permission_keys,
                    companion.role_permission_defaults,
                    companion.invite_ceiling,
                    companion.sub_roles,
                    companion.sub_role_permissions,
                    companion.sub_role_invitable_roles
  from anon, authenticated;

-- Catalogues: read-only to signed-in users (the settings UI is built
-- from them). No INSERT/UPDATE/DELETE grant at all.
grant select on companion.base_roles,
                companion.permission_keys,
                companion.role_permission_defaults,
                companion.invite_ceiling
  to authenticated;

-- Sub-role rows: read within your own org only. Writes are RPC-only.
grant select on companion.sub_roles,
                companion.sub_role_permissions,
                companion.sub_role_invitable_roles
  to authenticated;

drop policy if exists "catalogue readable"  on companion.base_roles;
drop policy if exists "catalogue readable"  on companion.permission_keys;
drop policy if exists "catalogue readable"  on companion.role_permission_defaults;
drop policy if exists "catalogue readable"  on companion.invite_ceiling;
create policy "catalogue readable" on companion.base_roles               for select to authenticated using (true);
create policy "catalogue readable" on companion.permission_keys          for select to authenticated using (true);
create policy "catalogue readable" on companion.role_permission_defaults for select to authenticated using (true);
create policy "catalogue readable" on companion.invite_ceiling           for select to authenticated using (true);

drop policy if exists "own org sub-roles readable" on companion.sub_roles;
create policy "own org sub-roles readable"
  on companion.sub_roles for select to authenticated
  using (org_id = public.my_org_id());

drop policy if exists "own org sub-role perms readable" on companion.sub_role_permissions;
create policy "own org sub-role perms readable"
  on companion.sub_role_permissions for select to authenticated
  using (exists (select 1 from companion.sub_roles s
                 where s.id = sub_role_id and s.org_id = public.my_org_id()));

drop policy if exists "own org sub-role invites readable" on companion.sub_role_invitable_roles;
create policy "own org sub-role invites readable"
  on companion.sub_role_invitable_roles for select to authenticated
  using (exists (select 1 from companion.sub_roles s
                 where s.id = sub_role_id and s.org_id = public.my_org_id()));

-- ═══ 8 · TRIGGERS · the mechanisms the columns claim to be ═════════

-- 8a · org_id and base_role are IMMUTABLE. The unique constraint only
--      makes the composite FK possible; it does not stop an UPDATE.
create or replace function companion.tg_sub_roles_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.org_id is distinct from old.org_id then
    raise exception 'sub_roles.org_id is immutable';
  end if;
  if new.base_role is distinct from old.base_role then
    raise exception 'sub_roles.base_role is immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sub_roles_immutable on companion.sub_roles;
create trigger sub_roles_immutable before update on companion.sub_roles
  for each row execute function companion.tg_sub_roles_immutable();

-- 8b · base_roles.sub_roles_allowed is ENFORCED, not documentation.
--      (sub_roles.base_role FKs to base_roles(role), which cannot
--       express "…where sub_roles_allowed".)
create or replace function companion.tg_sub_roles_allowed()
returns trigger language plpgsql set search_path = '' as $$
declare v_ok boolean;
begin
  select b.sub_roles_allowed into v_ok
  from companion.base_roles b where b.role = new.base_role;
  if not coalesce(v_ok, false) then
    raise exception 'sub-roles are not enabled for base role %', new.base_role;
  end if;
  return new;
end $$;
drop trigger if exists sub_roles_allowed_check on companion.sub_roles;
create trigger sub_roles_allowed_check before insert on companion.sub_roles
  for each row execute function companion.tg_sub_roles_allowed();

-- 8c · CEILING enforced at WRITE time (it is also enforced at READ time
--      in permissions_for, which is the half that holds even for rows
--      written by hand or by a service-role edge function).
create or replace function companion.tg_sub_role_perm_ceiling()
returns trigger language plpgsql set search_path = '' as $$
declare v_max boolean;
begin
  select d.max_allowed into v_max
  from companion.role_permission_defaults d
  join companion.sub_roles s on s.id = new.sub_role_id
  where d.base_role = s.base_role and d.permission_key = new.permission_key;
  if v_max is null then
    raise exception 'permission % is not defined for this sub-role''s base role', new.permission_key;
  end if;
  if new.allowed and not v_max then
    raise exception 'permission % exceeds the ceiling for this base role', new.permission_key;
  end if;
  return new;
end $$;
drop trigger if exists sub_role_perm_ceiling on companion.sub_role_permissions;
create trigger sub_role_perm_ceiling before insert or update on companion.sub_role_permissions
  for each row execute function companion.tg_sub_role_perm_ceiling();

-- 8d · invitable roles clamped to invite_ceiling[base_role].
create or replace function companion.tg_sub_role_invitable_ceiling()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from companion.sub_roles s
    join companion.invite_ceiling ic on ic.caller_base_role = s.base_role
    where s.id = new.sub_role_id and ic.invitable_role = new.invitable_role
  ) then
    raise exception 'role % is above the invite ceiling for this sub-role', new.invitable_role;
  end if;
  return new;
end $$;
drop trigger if exists sub_role_invitable_ceiling on companion.sub_role_invitable_roles;
create trigger sub_role_invitable_ceiling before insert or update on companion.sub_role_invitable_roles
  for each row execute function companion.tg_sub_role_invitable_ceiling();

-- 8e · Org deletion. organisations→sub_roles is CASCADE but
--      organisations→profiles.org_id is SET NULL, so without this the
--      cascade would hit profiles_sub_role_fk's RESTRICT and DELETING
--      AN ORGANISATION WOULD FAIL. Detach the pointers first.
create or replace function companion.tg_org_detach_sub_roles()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update companion.profiles set sub_role_id = null where org_id = old.id and sub_role_id is not null;
  update companion.invites  set sub_role_id = null where org_id = old.id and sub_role_id is not null;
  return old;
end $$;
drop trigger if exists org_detach_sub_roles on companion.organisations;
create trigger org_detach_sub_roles before delete on companion.organisations
  for each row execute function companion.tg_org_detach_sub_roles();

-- ═══ 9 · RESOLUTION ════════════════════════════════════════════════

-- 9a · The effective sub-role. Branch (a) matches on id AND org AND
--      base_role: the composite FK is MATCH SIMPLE and is NOT enforced
--      while profiles.org_id is NULL (001:26 is `on delete set null`),
--      so a pointer into a FOREIGN org's row is reachable. The FK alone
--      does not close that; these two extra predicates do, for free.
--      Archived rows still resolve in (a): archiving hides a sub-role
--      from pickers, it does not silently change an assignee's
--      permissions.
create or replace function companion.effective_sub_role(p_user_id uuid)
returns uuid
language sql stable security definer set search_path = '' as $$
  with me as (
    select p.role, p.org_id, p.sub_role_id
    from   companion.profiles p where p.id = p_user_id
  )
  select coalesce(
    (select s.id from companion.sub_roles s, me
      where s.id = me.sub_role_id
        and s.org_id is not distinct from me.org_id
        and s.base_role = me.role),
    (select s.id from companion.sub_roles s, me
      where s.org_id = me.org_id and s.base_role = me.role
        and s.is_default and s.archived_at is null
      limit 1)
  )
$$;

-- 9b · The whole algorithm, one statement.
--
--   1. No profile, no role, or NO ORG  -> DENY ALL (fail closed).
--      org_id IS NULL denies deliberately: remove_member (012:356) mints
--      role='coordinator', org_id=NULL, and the coordinator ALLOW-ALL
--      must not follow a detached profile out of its org.
--   2. coordinator WITH an org -> every catalogue key = true. Expanded,
--      not a '*' sentinel: the app consumes this map directly, and an
--      undefined key would hide every gated control from coordinators.
--   3. effective sub-role, else the org default, else none.
--   4. stored (if any) else base-role default, THEN clamped by ceiling.
--   5. Iterating role_permission_defaults (not the stored rows) makes an
--      unknown stored key inert, and makes role_permission_defaults the
--      true fail-closed floor: empty table => every non-coordinator
--      denied everything.
--
--   The asymmetry is deliberate: an absent KEY fails closed (unknown
--   capability); an absent ROW falls back to known defaults (known role,
--   known baseline). Deny-all for sub_role_id IS NULL would brick every
--   existing org the instant this ships.
--
--   SECURITY DEFINER is mandatory, not stylistic: companion.profiles'
--   SELECT policy is `org_id = public.my_org_id()` (006:33-40), so a
--   SECURITY INVOKER version would recurse — the exact failure 006 and
--   013 exist to fix.
create or replace function companion.permissions_for(p_user_id uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (
    select p.role, p.org_id from companion.profiles p where p.id = p_user_id
  )
  select case
    when (select role from me) is null or (select org_id from me) is null
      then '{}'::jsonb
    when (select role from me) = 'coordinator'
      then coalesce((select jsonb_object_agg(k.key, true)
                     from companion.permission_keys k), '{}'::jsonb)
    else coalesce((
      select jsonb_object_agg(
               d.permission_key,
               coalesce(srp.allowed, d.default_allowed) and d.max_allowed)
      from companion.role_permission_defaults d
      left join companion.sub_role_permissions srp
             on srp.sub_role_id    = companion.effective_sub_role(p_user_id)
            and srp.permission_key = d.permission_key
      where d.base_role = (select role from me)
    ), '{}'::jsonb)
  end
$$;

-- 9c · The RLS-facing wrapper. In `companion`, not `public`:
--      has_perm(text) is exactly the name a second app in this shared
--      MABApps project would pick, and 060's reason for leaving helpers
--      in public was about not MOVING existing ones. Policy bodies can
--      reference any schema regardless of the client's db.schema pin.
--      ONE call to permissions_for, not two.
create or replace function companion.has_perm(p_key text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((companion.permissions_for(auth.uid()) ->> p_key)::boolean, false)
$$;

-- 9d · App-facing. MUST be in `companion`: the client is schema-pinned
--      (src/lib/supabase.ts:14-20) and PostgREST resolves rpc/ inside
--      the pinned schema.
create or replace function companion.my_permissions()
returns jsonb language sql stable security definer set search_path = '' as $$
  select companion.permissions_for(auth.uid())
$$;

-- 9e · Invite BREADTH. Resolved from the SUB-ROLE, not profiles.role —
--      after the flip every ex-trusted holder IS a support_worker, so a
--      base-role-keyed matrix cannot express parity in either direction
--      without either losing the capability or granting it org-wide.
create or replace function companion.invitable_roles_for(p_user_id uuid)
returns setof text
language sql stable security definer set search_path = '' as $$
  select ic.invitable_role
  from   companion.profiles p
  join   companion.invite_ceiling ic on ic.caller_base_role = p.role
  where  p.id = p_user_id
    and  p.org_id is not null
    and  coalesce((companion.permissions_for(p_user_id) ->> 'invite_members')::boolean, false)
    and  (
      -- coordinator takes the full ceiling, consistent with the
      -- ALLOW-ALL short-circuit (and it cannot have a sub-role).
      p.role = 'coordinator'
      or exists (
        select 1 from companion.sub_role_invitable_roles sri
        where sri.sub_role_id    = companion.effective_sub_role(p_user_id)
          and sri.invitable_role = ic.invitable_role)
    )
$$;

create or replace function companion.my_invitable_roles()
returns setof text language sql stable security definer set search_path = '' as $$
  select companion.invitable_roles_for(auth.uid())
$$;

-- 9f · Seed a new org's default sub-roles. Called by the rewritten
--      create_organisation / setup_family_org in 069 and by the 070
--      backfill, so new orgs are never left without them.
create or replace function companion.ensure_default_sub_roles(p_org_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select b.role, b.label from companion.base_roles b
           where b.sub_roles_allowed and not b.is_transitional loop
    insert into companion.sub_roles (org_id, base_role, name, is_default)
    select p_org_id, r.role, r.label, true
    where not exists (
      select 1 from companion.sub_roles s
      where s.org_id = p_org_id and s.base_role = r.role and s.is_default);
  end loop;
end $$;

-- Postgres grants EXECUTE on new functions to PUBLIC by default.
revoke execute on function
  companion.permissions_for(uuid),
  companion.effective_sub_role(uuid),
  companion.invitable_roles_for(uuid),
  companion.ensure_default_sub_roles(uuid)
  from public, anon, authenticated;
revoke execute on function
  companion.has_perm(text), companion.my_permissions(), companion.my_invitable_roles()
  from public, anon;

grant execute on function
  companion.permissions_for(uuid),
  companion.effective_sub_role(uuid),
  companion.invitable_roles_for(uuid),
  companion.ensure_default_sub_roles(uuid)
  to service_role;
grant execute on function
  companion.has_perm(text), companion.my_permissions(), companion.my_invitable_roles()
  to authenticated, service_role;

-- ═══ 10 · MANAGEMENT RPCs · every one authorized, both ways ════════
-- The composite FK closes cross-tenant and cross-base-role assignment.
-- It says NOTHING about WHICH of your own org's same-base-role sub-roles
-- you may point at — and the entire point of sub-roles is that those
-- differ in privilege. So intra-org, intra-base-role escalation is
-- closed HERE, and only here. A SECURITY DEFINER function granted to
-- `authenticated` with no caller check is a WORSE write path than a
-- column grant, because it runs as owner and bypasses RLS.
--
-- Two checks in every function:
--   (i)  my_role() = 'coordinator'
--   (ii) org_id = my_org_id() on EVERY id argument  <- the forgotten one

create or replace function companion.create_sub_role(
  p_base_role       text,
  p_name            text,
  p_permissions     jsonb   default '{}'::jsonb,
  p_invitable_roles text[]  default '{}'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_key text; v_val jsonb; r text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  if v_org is null then raise exception 'forbidden'; end if;

  insert into companion.sub_roles (org_id, base_role, name, created_by)
  values (v_org, p_base_role, btrim(p_name), auth.uid())
  returning id into v_id;

  for v_key, v_val in select * from pg_catalog.jsonb_each(coalesce(p_permissions,'{}'::jsonb)) loop
    if pg_catalog.jsonb_typeof(v_val) = 'boolean' then
      insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
      values (v_id, v_key, (v_val #>> '{}')::boolean);
    end if;
  end loop;

  foreach r in array coalesce(p_invitable_roles, '{}') loop
    insert into companion.sub_role_invitable_roles (sub_role_id, invitable_role) values (v_id, r);
  end loop;

  return v_id;
end $$;

create or replace function companion.update_sub_role(
  p_id              uuid,
  p_name            text,
  p_permissions     jsonb,
  p_invitable_roles text[]
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_key text; v_val jsonb; r text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  if not exists (select 1 from companion.sub_roles
                 where id = p_id and org_id = public.my_org_id()) then
    raise exception 'not_in_your_org';
  end if;

  update companion.sub_roles set name = btrim(p_name) where id = p_id;

  delete from companion.sub_role_permissions where sub_role_id = p_id;
  for v_key, v_val in select * from pg_catalog.jsonb_each(coalesce(p_permissions,'{}'::jsonb)) loop
    if pg_catalog.jsonb_typeof(v_val) = 'boolean' then
      insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
      values (p_id, v_key, (v_val #>> '{}')::boolean);
    end if;
  end loop;

  delete from companion.sub_role_invitable_roles where sub_role_id = p_id;
  foreach r in array coalesce(p_invitable_roles, '{}') loop
    insert into companion.sub_role_invitable_roles (sub_role_id, invitable_role) values (p_id, r);
  end loop;
end $$;

create or replace function companion.archive_sub_role(p_id uuid, p_archived boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  if not exists (select 1 from companion.sub_roles
                 where id = p_id and org_id = public.my_org_id()) then
    raise exception 'not_in_your_org';
  end if;
  if p_archived and exists (select 1 from companion.sub_roles where id = p_id and is_default) then
    raise exception 'cannot_archive_default';
  end if;
  update companion.sub_roles
    set archived_at = case when p_archived then now() else null end
    where id = p_id;
end $$;

-- Hard delete is only ever reachable through an explicit reassignment.
-- The alternative (ON DELETE SET NULL) is a SILENT privilege change to
-- real people; refuse it at the storage layer and make it explicit here.
create or replace function companion.delete_sub_role(p_id uuid, p_reassign_to uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_base text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  select base_role into v_base from companion.sub_roles where id = p_id and org_id = v_org;
  if v_base is null then raise exception 'not_in_your_org'; end if;
  if exists (select 1 from companion.sub_roles where id = p_id and is_default) then
    raise exception 'cannot_delete_default';
  end if;
  if p_reassign_to is null then raise exception 'reassign_target_required'; end if;
  if not exists (select 1 from companion.sub_roles
                 where id = p_reassign_to and org_id = v_org
                   and base_role = v_base and archived_at is null) then
    raise exception 'invalid_reassign_target';
  end if;

  update companion.profiles set sub_role_id = p_reassign_to where sub_role_id = p_id;
  update companion.invites  set sub_role_id = p_reassign_to where sub_role_id = p_id;
  delete from companion.sub_roles where id = p_id;
end $$;

-- THE self-escalation gate. Without check (ii) a plain worker could call
-- assign_sub_role(own uid, <'Trusted worker' id>) and the composite FK
-- would be perfectly satisfied: same org, same base role.
create or replace function companion.assign_sub_role(p_user_id uuid, p_sub_role_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_target_role text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  select role into v_target_role
    from companion.profiles where id = p_user_id and org_id = v_org;
  if v_target_role is null then raise exception 'not_in_your_org'; end if;

  if p_sub_role_id is not null and not exists (
       select 1 from companion.sub_roles
       where id = p_sub_role_id and org_id = v_org
         and base_role = v_target_role and archived_at is null) then
    raise exception 'invalid_sub_role';
  end if;

  update companion.profiles set sub_role_id = p_sub_role_id where id = p_user_id;
end $$;

create or replace function companion.assign_invite_sub_role(p_invite_id uuid, p_sub_role_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_role text;
begin
  if public.my_role() <> 'coordinator' then raise exception 'forbidden'; end if;
  v_org := public.my_org_id();
  select role into v_role from companion.invites where id = p_invite_id and org_id = v_org;
  if v_role is null then raise exception 'not_in_your_org'; end if;
  if p_sub_role_id is not null and not exists (
       select 1 from companion.sub_roles
       where id = p_sub_role_id and org_id = v_org
         and base_role = v_role and archived_at is null) then
    raise exception 'invalid_sub_role';
  end if;
  update companion.invites set sub_role_id = p_sub_role_id where id = p_invite_id;
end $$;

revoke execute on function
  companion.create_sub_role(text,text,jsonb,text[]),
  companion.update_sub_role(uuid,text,jsonb,text[]),
  companion.archive_sub_role(uuid,boolean),
  companion.delete_sub_role(uuid,uuid),
  companion.assign_sub_role(uuid,uuid),
  companion.assign_invite_sub_role(uuid,uuid)
  from public, anon;
grant execute on function
  companion.create_sub_role(text,text,jsonb,text[]),
  companion.update_sub_role(uuid,text,jsonb,text[]),
  companion.archive_sub_role(uuid,boolean),
  companion.delete_sub_role(uuid,uuid),
  companion.assign_sub_role(uuid,uuid),
  companion.assign_invite_sub_role(uuid,uuid)
  to authenticated;

commit;

-- ═══ POST-068 ASSERTIONS · all three must return ZERO rows ═════════
-- A. Any new table without RLS.
select relname from pg_class
where  relnamespace = 'companion'::regnamespace
  and  relname in ('base_roles','permission_keys','role_permission_defaults',
                   'invite_ceiling','sub_roles','sub_role_permissions',
                   'sub_role_invitable_roles')
  and  not relrowsecurity;

-- B. Any write privilege for anon/authenticated on the new tables.
select table_name, grantee, privilege_type
from   information_schema.role_table_grants
where  table_schema = 'companion'
  and  table_name in ('base_roles','permission_keys','role_permission_defaults',
                      'invite_ceiling','sub_roles','sub_role_permissions',
                      'sub_role_invitable_roles')
  and  grantee in ('anon','authenticated')
  and  privilege_type <> 'SELECT';

-- C. Any new function that is not SECURITY DEFINER with search_path=''.
select proname, prosecdef, proconfig from pg_proc
where  pronamespace = 'companion'::regnamespace
  and  proname in ('permissions_for','has_perm','my_permissions',
                   'effective_sub_role','invitable_roles_for','my_invitable_roles',
                   'ensure_default_sub_roles')
  and  (not prosecdef or proconfig is distinct from array['search_path=']);
```

## `069_sub_role_write_paths.sql` — close the mint path, fix every writer

```sql
-- ═══════════════════════════════════════════════════════════════════
-- 069 · Every write path that touches profiles.role or invites.role
--       learns about sub_role_id, and promote_member stops minting
--       'trusted_support_worker'. Runs BEFORE any data moves, so the
--       window in which the retired value can be re-created is
--       structurally empty rather than merely narrow.
--
-- STOP. Before running: paste the output of inspect query I9 somewhere
-- durable. 060's sweep (lines 105-160) rewrote these bodies in place —
-- table refs to companion.* and search_path to 'companion','public' —
-- so the migration FILES no longer match what is deployed. The bodies
-- below are reconstructed to match the swept form. Diff them against I9
-- before you commit; if anything differs, take I9 as truth.
--
-- Also adds the `invites` permissive policies for sub-roled workers.
-- They are additive: sub_role_invitable_roles is empty for every default
-- sub-role, so they admit nothing until 070 backfills. Shipping them
-- here means there is ZERO window between the new invite path opening
-- and 071 dropping the old trusted-only one.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 1 · promote_member: refuse the retired value ───────────────────
-- Returns {ok:false,error}, not an exception, so a stale PWA client
-- (sw.ts:20-23 waits for a user tap — an installed app can run the old
-- bundle indefinitely) shows a clean message rather than a raw
-- constraint violation.
create or replace function companion.promote_member(p_user_id uuid, p_new_role text)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_org_id uuid; v_caller_role text; v_target_role text; v_org_type text;
begin
  select org_id, role into v_org_id, v_caller_role
    from companion.profiles where id = auth.uid();
  if v_caller_role <> 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can change roles');
  end if;

  select role into v_target_role
    from companion.profiles where id = p_user_id and org_id = v_org_id;
  if v_target_role is null then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  if p_new_role = 'trusted_support_worker' then
    return json_build_object('ok', false,
      'error', 'Trusted worker is now a sub-role — assign it from the member''s row instead');
  elsif p_new_role = 'coordinator' then
    select org_type into v_org_type from companion.organisations where id = v_org_id;
    if v_org_type <> 'family' then
      return json_build_object('ok', false, 'error', 'Coordinator promotion is only available in family organisations');
    end if;
    if v_target_role <> 'family' then
      return json_build_object('ok', false, 'error', 'Only family members can become coordinators');
    end if;
  else
    return json_build_object('ok', false, 'error', 'Invalid promotion target role');
  end if;

  -- role and sub_role_id MOVE TOGETHER. A second statement fails the
  -- composite FK; there is no coordinator sub-role by construction.
  update companion.profiles
    set role = p_new_role, sub_role_id = null
    where id = p_user_id and org_id = v_org_id;

  return json_build_object('ok', true);
end $$;

-- ── 2 · demote_member ──────────────────────────────────────────────
-- Keeps the trusted->support_worker branch: it performs exactly the
-- conversion 071 performs, so it is harmless (and useful) while data
-- still holds the retired value. Removed in cleanup.
create or replace function companion.demote_member(p_user_id uuid)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_org_id uuid; v_caller_role text; v_target_role text;
  v_org_type text; v_coord_count int; v_new_role text; v_default_sub uuid;
begin
  select org_id, role into v_org_id, v_caller_role
    from companion.profiles where id = auth.uid();
  if v_caller_role <> 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can change roles');
  end if;

  select role into v_target_role
    from companion.profiles where id = p_user_id and org_id = v_org_id;
  if v_target_role is null then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  if v_target_role = 'coordinator' then
    select org_type into v_org_type from companion.organisations where id = v_org_id;
    if v_org_type <> 'family' then
      return json_build_object('ok', false, 'error', 'Coordinator demotion only applies in family organisations');
    end if;
    select count(*) into v_coord_count
      from companion.profiles where org_id = v_org_id and role = 'coordinator';
    if v_coord_count <= 1 then
      return json_build_object('ok', false, 'error', 'Cannot demote the last coordinator');
    end if;
    v_new_role := 'family';
  elsif v_target_role = 'trusted_support_worker' then
    v_new_role := 'support_worker';
  else
    return json_build_object('ok', false, 'error', 'This role cannot be demoted');
  end if;

  select s.id into v_default_sub from companion.sub_roles s
   where s.org_id = v_org_id and s.base_role = v_new_role
     and s.is_default and s.archived_at is null limit 1;

  update companion.profiles
    set role = v_new_role, sub_role_id = v_default_sub
    where id = p_user_id and org_id = v_org_id;

  return json_build_object('ok', true);
end $$;

-- ── 3 · accept_invite ──────────────────────────────────────────────
-- Two changes: it carries invites.sub_role_id onto the profile in the
-- SAME UPDATE, and it gains the coordinator-downgrade guard that
-- redeem-invite/index.ts:73 has had all along. Without that guard a
-- lower-role invite accepted by a signed-in coordinator whose email
-- matches DEMOTES them (041:58-60 overwrites role blindly). Pre-existing
-- and unrelated, but the function is open and carrying it forward into a
-- sub_role_id write would be worse.
create or replace function companion.accept_invite(p_token text)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare
  v_uid uuid := auth.uid(); v_email text; v_invite record;
  v_existing_role text; v_role text; v_sub uuid;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not signed in'); end if;
  select email into v_email from auth.users where id = v_uid;

  select * into v_invite from companion.invites
   where token = p_token and status = 'pending';
  if v_invite.id is null then
    return json_build_object('ok', false, 'error', 'Invitation not found or already used');
  end if;
  if v_invite.expires_at is not null and v_invite.expires_at < now() then
    return json_build_object('ok', false, 'error', 'This invitation has expired');
  end if;
  if lower(v_invite.email) <> lower(v_email) then
    return json_build_object('ok', false, 'error', 'This invitation was sent to a different email address');
  end if;

  select role into v_existing_role from companion.profiles where id = v_uid;
  if v_existing_role = 'coordinator' then
    -- Never downgrade an existing coordinator.
    v_role := 'coordinator';
    v_sub  := null;
  else
    v_role := v_invite.role;
    v_sub  := v_invite.sub_role_id;
    if v_sub is null then
      select s.id into v_sub from companion.sub_roles s
       where s.org_id = v_invite.org_id and s.base_role = v_role
         and s.is_default and s.archived_at is null limit 1;
    end if;
  end if;

  update companion.profiles
    set org_id = v_invite.org_id, role = v_role, sub_role_id = v_sub
    where id = v_uid;

  if v_invite.client_id is not null then
    if v_role = 'family' then
      insert into companion.client_family (client_id, family_id, status)
      values (v_invite.client_id, v_uid, 'active')
      on conflict (client_id, family_id) do update set status = 'active';
    elsif v_role in ('support_worker', 'trusted_support_worker') then
      insert into companion.client_workers (client_id, worker_id)
      values (v_invite.client_id, v_uid)
      on conflict (client_id, worker_id) do nothing;
    elsif v_role = 'recipient' then
      update companion.clients set recipient_profile_id = v_uid where id = v_invite.client_id;
    elsif v_role = 'therapist' then
      insert into companion.client_circle (client_id, therapist_id, status)
      values (v_invite.client_id, v_uid, 'in_circle')
      on conflict (client_id, therapist_id) do update set status = 'in_circle';
    end if;
  end if;

  update companion.invites set status = 'accepted' where id = v_invite.id;
  return json_build_object('ok', true, 'role', v_role);
end $$;

-- ── 4 · remove_member ──────────────────────────────────────────────
-- Four fixes to 012:321-362:
--   (a) nulls sub_role_id (with org_id NULL, MATCH SIMPLE would SKIP
--       the FK check and leave a DANGLING pointer with no error at all);
--   (b) DELETES the link rows. client_ids_for_worker() (013:29-31) has
--       no org test, and `clients` SELECT (013:91) and behaviour_notes
--       SELECT/UPDATE (013:210/214) have no role AND no org test, so a
--       removed worker retained read access to their old org's
--       participant records and BEHAVIOUR NOTES;
--   (c) stops minting role='coordinator' on a detached profile. It
--       relies on `org_id is null` instead, and permissions_for now
--       denies everything when org_id is null;
--   (d) recreated in `companion` and revoked in `public`. It was NOT in
--       060's rpc_names array, so public.remove_member is still
--       callable with a `Content-Profile: public` header even though the
--       app's client is schema-pinned.
create or replace function companion.remove_member(p_user_id uuid)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare v_org_id uuid; v_caller_role text; v_target_role text; v_coord_count int;
begin
  select org_id, role into v_org_id, v_caller_role
    from companion.profiles where id = auth.uid();
  if v_caller_role <> 'coordinator' then
    return json_build_object('ok', false, 'error', 'Only coordinators can remove members');
  end if;

  if p_user_id = auth.uid() then
    select count(*) into v_coord_count
      from companion.profiles where org_id = v_org_id and role = 'coordinator';
    if v_coord_count <= 1 then
      return json_build_object('ok', false, 'error',
        'Cannot remove yourself — you are the only coordinator');
    end if;
  end if;

  select role into v_target_role
    from companion.profiles where id = p_user_id and org_id = v_org_id;
  if v_target_role is null then
    return json_build_object('ok', false, 'error', 'User not in your organisation');
  end if;

  delete from companion.client_workers where worker_id  = p_user_id;
  delete from companion.client_family  where family_id  = p_user_id;
  delete from companion.client_circle  where therapist_id = p_user_id;
  update companion.clients set recipient_profile_id = null
    where recipient_profile_id = p_user_id;
  update companion.clients set decision_maker_id = null
    where decision_maker_id = p_user_id;

  update companion.profiles
    set org_id = null, sub_role_id = null
    where id = p_user_id;

  return json_build_object('ok', true);
end $$;

revoke all on function public.remove_member(uuid) from public, anon, authenticated;
revoke execute on function companion.remove_member(uuid) from public, anon;
grant  execute on function companion.remove_member(uuid) to authenticated;

-- ── 5 · create_organisation ────────────────────────────────────────
-- Without `sub_role_id = null` here, a previously-removed member (or any
-- profile carrying a stale pointer) hits profiles_sub_role_fk looking
-- for a base_role='coordinator' sub-role — forbidden by
-- sub_roles_no_coordinator. The RPC would RAISE and the user could NEVER
-- CREATE AN ORG. Primary onboarding path, unrecoverable by the user.
create or replace function companion.create_organisation(
  p_name text, p_state text, p_services text[]
) returns uuid language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare v_uid uuid := auth.uid(); v_current_org uuid; v_org_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select org_id into v_current_org from companion.profiles where id = v_uid;
  if v_current_org is not null then raise exception 'already_in_org'; end if;

  insert into companion.organisations (name, state, services, plan, billing_status)
  values (p_name, p_state, coalesce(p_services, '{}'), 'trial', 'trial')
  returning id into v_org_id;

  update companion.profiles
    set org_id = v_org_id, role = 'coordinator', sub_role_id = null
    where id = v_uid;

  insert into companion.org_settings (org_id) values (v_org_id);
  perform companion.ensure_default_sub_roles(v_org_id);
  return v_org_id;
end $$;
revoke execute on function companion.create_organisation(text,text,text[]) from public, anon;
grant  execute on function companion.create_organisation(text,text,text[]) to authenticated;

-- ── 6 · setup_family_org ── same hard block, family-plan signup ────
create or replace function companion.setup_family_org(p_participant_name text)
returns json language plpgsql security definer
set search_path = 'companion', 'public' as $$
declare v_uid uuid := auth.uid(); v_current_org uuid; v_org_id uuid; v_client_id uuid;
begin
  if v_uid is null then return json_build_object('ok', false, 'error', 'Not signed in'); end if;
  select org_id into v_current_org from companion.profiles where id = v_uid;
  if v_current_org is not null then
    return json_build_object('ok', false, 'error', 'Already in an organisation');
  end if;

  insert into companion.organisations (name, org_type, plan, billing_status)
  values (p_participant_name || '''s circle', 'family', 'family', 'trial')
  returning id into v_org_id;

  update companion.profiles
    set org_id = v_org_id, role = 'coordinator', sub_role_id = null
    where id = v_uid;

  insert into companion.org_settings (org_id) values (v_org_id)
    on conflict (org_id) do nothing;

  insert into companion.clients (org_id, full_name)
  values (v_org_id, p_participant_name) returning id into v_client_id;

  insert into companion.client_family (client_id, family_id, status)
  values (v_client_id, v_uid, 'active')
  on conflict (client_id, family_id) do update set status = 'active';

  perform companion.ensure_default_sub_roles(v_org_id);
  return json_build_object('ok', true, 'org_id', v_org_id, 'client_id', v_client_id);
end $$;
revoke execute on function companion.setup_family_org(text) from public, anon;
grant  execute on function companion.setup_family_org(text) to authenticated;
-- ⚠ RECONCILE AGAINST I9 BEFORE COMMITTING. setup_family_org's live body
--   is 014:9-44 as swept by 060; the reconstruction above may differ in
--   details (org name format, extra inserts). Take I9 as truth and add
--   only `sub_role_id = null` + the ensure_default_sub_roles call.

-- ── 7 · get_org_members: surface the sub-role ──────────────────────
drop function if exists public.get_org_members();
drop function if exists companion.get_org_members();
create function companion.get_org_members()
returns table (id uuid, full_name text, role text, email text, phone text,
               sub_role_id uuid, sub_role_name text)
language sql security definer set search_path = 'companion', 'public' as $$
  select p.id, p.full_name, p.role, u.email, p.phone,
         p.sub_role_id, s.name
  from   companion.profiles p
  join   auth.users u on u.id = p.id
  left   join companion.sub_roles s on s.id = p.sub_role_id
  where  p.org_id = public.my_org_id()
  order  by p.role, p.full_name;
$$;
revoke execute on function companion.get_org_members() from public, anon;
grant  execute on function companion.get_org_members() to authenticated;

-- ── 8 · invites: the permissive policies for sub-roled workers ─────
-- invite_members is kind='grant', NOT a gate: after 071 drops the two
-- trusted-only policies (012:91/102) a support_worker has NO permissive
-- INSERT on invites at all, and a RESTRICTIVE policy can only ever
-- remove rows. These admit nothing today (sub_role_invitable_roles is
-- empty everywhere) and light up exactly when 070 backfills.
drop policy if exists "sub-roled members can create allowed invites" on companion.invites;
create policy "sub-roled members can create allowed invites"
  on companion.invites for insert to authenticated
  with check (
    org_id = public.my_org_id()
    and role in (select companion.my_invitable_roles())
    and (select companion.has_perm('invite_members'))
  );

drop policy if exists "sub-roled members can view their allowed invites" on companion.invites;
create policy "sub-roled members can view their allowed invites"
  on companion.invites for select to authenticated
  using (
    org_id = public.my_org_id()
    and role in (select companion.my_invitable_roles())
    and (select companion.has_perm('invite_members'))
  );

-- ── 9 · Forward-compat shim for stale PWA clients ─────────────────
-- sw.ts:20-23 only calls skipWaiting() on a message and UpdatePrompt
-- requires a user tap, so an installed PWA can run the old bundle
-- indefinitely. Without this, a stale coordinator's Save on
-- PermissionsPage becomes a SILENT NO-OP once the new code reads
-- my_permissions() instead. This translates a legacy write into the
-- org's default sub-roles, clamped by max_allowed, storing only what
-- DIFFERS from the default. Removed in cleanup.
create or replace function companion.tg_org_settings_legacy_permissions()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text; v_perms jsonb; v_key text; v_val jsonb;
  v_sub uuid; v_default boolean; v_max boolean; v_allowed boolean;
begin
  if new.permissions is null then return new; end if;
  if tg_op = 'UPDATE' and new.permissions is not distinct from old.permissions then
    return new;
  end if;

  for v_role, v_perms in select * from pg_catalog.jsonb_each(new.permissions) loop
    if pg_catalog.jsonb_typeof(v_perms) <> 'object' then continue; end if;
    select s.id into v_sub from companion.sub_roles s
     where s.org_id = new.org_id and s.base_role = v_role
       and s.is_default and s.archived_at is null limit 1;
    if v_sub is null then continue; end if;

    for v_key, v_val in select * from pg_catalog.jsonb_each(v_perms) loop
      if pg_catalog.jsonb_typeof(v_val) <> 'boolean' then continue; end if;
      select d.default_allowed, d.max_allowed into v_default, v_max
        from companion.role_permission_defaults d
       where d.base_role = v_role and d.permission_key = v_key;
      if v_max is null then continue; end if;
      v_allowed := (v_val #>> '{}')::boolean and v_max;
      if v_allowed = v_default then
        delete from companion.sub_role_permissions
         where sub_role_id = v_sub and permission_key = v_key;
      else
        insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
        values (v_sub, v_key, v_allowed)
        on conflict (sub_role_id, permission_key) do update set allowed = excluded.allowed;
      end if;
    end loop;
  end loop;
  return new;
end $$;
drop trigger if exists org_settings_legacy_permissions on companion.org_settings;
create trigger org_settings_legacy_permissions
  before insert or update on companion.org_settings
  for each row execute function companion.tg_org_settings_legacy_permissions();

-- ── 10 · client_ids_for_worker gains an org test ───────────────────
-- Closes the residue that survives (b) above for anyone already
-- detached: `clients` SELECT (013:91) and behaviour_notes SELECT/UPDATE
-- (013:210/214) are assignment-only with no role and no org test, so
-- this one change tenant-bounds every policy built on the helper.
create or replace function public.client_ids_for_worker()
returns setof uuid language sql stable security definer
set search_path = 'companion', 'public' as $$
  select cw.client_id
  from   companion.client_workers cw
  join   companion.clients c on c.id = cw.client_id
  where  cw.worker_id = auth.uid()
    and  c.org_id = public.my_org_id()
$$;

-- ── 11 · VALIDATE the composite FKs ───────────────────────────────
alter table companion.profiles validate constraint profiles_sub_role_fk;
alter table companion.invites  validate constraint invites_sub_role_fk;

commit;
```

> **⚠ Behaviour change in step 10.** Adding the org join to `client_ids_for_worker()` is the only genuinely behaviour-changing statement in `069`. For any *correctly-membered* worker it is a no-op (`c.org_id` always equals their `org_id`). It only bites a profile whose `org_id` no longer matches its assignments — i.e. exactly the detached case. Run this first to see the population, and if it is non-empty, deal with those rows before running `069`:
> ```sql
> select p.id, p.full_name, p.org_id as profile_org, c.org_id as client_org, count(*)
> from companion.client_workers cw
> join companion.profiles p on p.id = cw.worker_id
> join companion.clients  c on c.id = cw.client_id
> where p.org_id is distinct from c.org_id
> group by 1,2,3,4;
> ```

## `070_sub_role_backfill.sql` — data, guarded and re-runnable

```sql
-- ═══════════════════════════════════════════════════════════════════
-- 070 · Backfill. Creates each org's default sub-roles, migrates the
--       legacy org-wide overrides onto them, and creates + assigns a
--       named "Trusted worker" sub-role PER USER.
--
--       This is the crux. An org-wide write to
--       org_settings.permissions -> 'support_worker' -> invite_members
--       would be STRICTLY WIDER than the status quo, because that column
--       is keyed by ROLE, not by user. A named sub-role assigned per
--       person gives EXACT per-user fidelity with NO org-wide widening.
--
--       Re-runnable: every insert is `where not exists`.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0 · PO DIAL D4 ─────────────────────────────────────────────────
--   po_assign_trusted = true  -> assign every trusted holder to the
--                               named sub-role (preserves parity)
--   po_assign_trusted = false -> create it but leave it unassigned
--                               (correct if the invite ability was never
--                                used; it has no nav path to /members)
insert into companion.migration_gates (gate, note)
values ('po_assign_trusted', 'true')
on conflict (gate) do nothing;

-- ── 1 · Default sub-roles for every existing org ──────────────────
--   NOTE: ensure_default_sub_roles only creates rows for base roles
--   where sub_roles_allowed is true (D2: support_worker only). Orgs
--   therefore get ONE default sub-role each in this pass. That is
--   deliberate — see §4.
do $$
declare r record;
begin
  for r in select id from companion.organisations loop
    perform companion.ensure_default_sub_roles(r.id);
  end loop;
end $$;

-- ── 2 · Migrate legacy org-wide overrides onto the default sub-roles
--   Records ONLY values that DIFFER from role_permission_defaults.
--   PermissionsPage.tsx:100 materialises every default on every Save,
--   so storing the merged result would freeze materialised defaults as
--   explicit per-sub-role permissions, indistinguishable from intent,
--   FOREVER — and would destroy the evidence PO decision D5 needs.
insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
select s.id, kv.key, (kv.value #>> '{}')::boolean and d.max_allowed
from   companion.org_settings os
cross  join lateral jsonb_each(coalesce(os.permissions,'{}'::jsonb)) as r(role_key, perms)
cross  join lateral jsonb_each(r.perms)                              as kv(key, value)
join   companion.sub_roles s
         on s.org_id = os.org_id and s.base_role = r.role_key
        and s.is_default and s.archived_at is null
join   companion.role_permission_defaults d
         on d.base_role = r.role_key and d.permission_key = kv.key
where  jsonb_typeof(kv.value) = 'boolean'
  and  ((kv.value #>> '{}')::boolean and d.max_allowed) is distinct from d.default_allowed
on conflict (sub_role_id, permission_key) do nothing;

-- ── 3 · The named "Trusted worker" sub-role, one per affected org ──
insert into companion.sub_roles (org_id, base_role, name, is_default)
select distinct o.id, 'support_worker', 'Trusted worker', false
from   companion.organisations o
where  (exists (select 1 from companion.profiles p
                 where p.org_id = o.id and p.role = 'trusted_support_worker')
     or exists (select 1 from companion.invites i
                 where i.org_id = o.id and i.role = 'trusted_support_worker'))
  and  not exists (select 1 from companion.sub_roles s
                    where s.org_id = o.id and s.base_role = 'support_worker'
                      and lower(btrim(s.name)) = 'trusted worker'
                      and s.archived_at is null);

-- ── 4 · Its permissions: the support_worker default set, overlaid
--        with the org's stored support_worker overrides, overlaid with
--        the org's stored trusted_support_worker overrides (which would
--        otherwise become permanently unreachable — usePermissions.ts:118
--        keys them by the CALLER'S role string), overlaid with
--        invite_members = true. Only differences from the default are
--        stored, so this is the same rule as step 2.
insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
select tw.id, d.permission_key,
       (coalesce(
          (os.permissions -> 'trusted_support_worker' ->> d.permission_key)::boolean,
          (os.permissions -> 'support_worker'         ->> d.permission_key)::boolean,
          d.default_allowed)
        or d.permission_key = 'invite_members')          -- the one real delta
       and d.max_allowed
from   companion.sub_roles tw
join   companion.role_permission_defaults d on d.base_role = 'support_worker'
left   join companion.org_settings os on os.org_id = tw.org_id
where  tw.base_role = 'support_worker'
  and  lower(btrim(tw.name)) = 'trusted worker'
  and  tw.archived_at is null
  and  ((coalesce(
            (os.permissions -> 'trusted_support_worker' ->> d.permission_key)::boolean,
            (os.permissions -> 'support_worker'         ->> d.permission_key)::boolean,
            d.default_allowed)
          or d.permission_key = 'invite_members')
        and d.max_allowed) is distinct from d.default_allowed
on conflict (sub_role_id, permission_key) do nothing;

-- ── 5 · Its invite BREADTH: exactly ['support_worker'] ─────────────
--   NOT the frontend's ['family','support_worker','trusted_support_worker']
--   (MembersPage.tsx:406-407). Two of those three have always 403'd:
--   invite-member/index.ts:63 is trusted_support_worker: ['support_worker'].
--   PermissionsPage.tsx:40's own help text agrees ("workers can only
--   invite other support workers"). Adding 'family' would be a NEW
--   privilege escalation — family defaults grant view_all_entries AND
--   edit_any_entry (usePermissions.ts:41-42).
insert into companion.sub_role_invitable_roles (sub_role_id, invitable_role)
select tw.id, 'support_worker'
from   companion.sub_roles tw
where  tw.base_role = 'support_worker'
  and  lower(btrim(tw.name)) = 'trusted worker'
  and  tw.archived_at is null
on conflict do nothing;

-- ── 6 · Assign, PER USER. The transitional base_roles row is what
--        makes this possible while profiles.role is still the retired
--        string: the composite FK looks for
--        sub_roles(id, org_id, base_role='trusted_support_worker').
--        So the named sub-role above cannot satisfy it — we need a
--        trusted-flavoured twin. Create it, assign it, and 071 re-points
--        everyone at the support_worker one in the same statement as
--        the role flip.
insert into companion.sub_roles (org_id, base_role, name, is_default)
select distinct p.org_id, 'trusted_support_worker', 'Trusted worker (migrating)', false
from   companion.profiles p
where  p.role = 'trusted_support_worker' and p.org_id is not null
  and  not exists (select 1 from companion.sub_roles s
                    where s.org_id = p.org_id
                      and s.base_role = 'trusted_support_worker');

insert into companion.sub_roles (org_id, base_role, name, is_default)
select distinct i.org_id, 'trusted_support_worker', 'Trusted worker (migrating)', false
from   companion.invites i
where  i.role = 'trusted_support_worker'
  and  not exists (select 1 from companion.sub_roles s
                    where s.org_id = i.org_id
                      and s.base_role = 'trusted_support_worker');

update companion.profiles p
   set sub_role_id = s.id
from companion.sub_roles s
where s.org_id = p.org_id
  and s.base_role = 'trusted_support_worker'
  and p.role = 'trusted_support_worker'
  and p.sub_role_id is null
  and (select note from companion.migration_gates where gate = 'po_assign_trusted') = 'true';

update companion.invites i
   set sub_role_id = s.id
from companion.sub_roles s
where s.org_id = i.org_id
  and s.base_role = 'trusted_support_worker'
  and i.role = 'trusted_support_worker'
  and i.sub_role_id is null;

-- ── 7 · Every non-trusted member gets their org's default sub-role,
--        so resolution takes branch (a) rather than (b). Purely
--        cosmetic for correctness; makes the data self-describing.
update companion.profiles p
   set sub_role_id = s.id
from companion.sub_roles s
where s.org_id = p.org_id and s.base_role = p.role
  and s.is_default and s.archived_at is null
  and p.sub_role_id is null and p.org_id is not null;

-- ── 8 · ASSERT. Fail loudly rather than half-apply. ────────────────
do $$
declare n_p bigint; n_i bigint; n_tw bigint;
begin
  if (select note from companion.migration_gates where gate = 'po_assign_trusted') = 'true' then
    select count(*) into n_p from companion.profiles
     where role = 'trusted_support_worker' and sub_role_id is null and org_id is not null;
    if n_p > 0 then
      raise exception 'Backfill incomplete: % trusted profile(s) unassigned', n_p;
    end if;
  end if;

  select count(*) into n_i from companion.invites
   where role = 'trusted_support_worker' and sub_role_id is null;
  if n_i > 0 then
    raise exception 'Backfill incomplete: % trusted invite(s) unassigned', n_i;
  end if;

  select count(*) into n_tw from companion.sub_roles
   where base_role = 'support_worker' and lower(btrim(name)) = 'trusted worker';
  raise notice 'Created/found % "Trusted worker" sub-role(s)', n_tw;
end $$;

commit;

-- ── POST-070 PARITY TEST. This single query IS the parity test. ────
-- Every row must show invite_members = true and support_worker in the
-- invitable set. Run it again after 071 — it must be identical.
select p.id, p.full_name, p.role,
       companion.permissions_for(p.id) ->> 'invite_members' as invite_members,
       array(select companion.invitable_roles_for(p.id))     as invitable
from   companion.profiles p
where  p.role in ('trusted_support_worker','support_worker')
  and  p.sub_role_id is not null
order  by p.role desc, p.full_name;
```

## `071_retire_trusted_support_worker.sql` — the gated flip

```sql
-- ═══════════════════════════════════════════════════════════════════
-- 071 · Retire trusted_support_worker.
--
--       DO NOT RUN until the app + edge functions are deployed AND you
--       have personally confirmed the served build no longer offers the
--       role. The gate below is a HUMAN ATTESTATION, not an inference —
--       "the frontend shipped" does not mean "clients are running it"
--       (sw.ts:20-23 waits for a user tap; an installed PWA can run the
--       old bundle indefinitely).
--
--       To open the gate, after checking the live build:
--         insert into companion.migration_gates (gate, note)
--         values ('frontend_retirement_verified', '<build/version + date>');
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ── 0 · GATE ───────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from companion.migration_gates
                 where gate = 'frontend_retirement_verified') then
    raise exception
      'Gate closed. Verify the served frontend no longer offers trusted_support_worker, then insert the frontend_retirement_verified gate row.';
  end if;
end $$;

-- ── 1 · CATCH-UP backfill, in this transaction ─────────────────────
--   069 closed the mint path (promote_member refuses) and 070 ran, but a
--   pending invite created before 069 could still have been accepted in
--   between. Re-do 070 steps 6-7 for anything new, then assert.
insert into companion.sub_roles (org_id, base_role, name, is_default)
select distinct p.org_id, 'trusted_support_worker', 'Trusted worker (migrating)', false
from   companion.profiles p
where  p.role = 'trusted_support_worker' and p.org_id is not null
  and  not exists (select 1 from companion.sub_roles s
                    where s.org_id = p.org_id and s.base_role = 'trusted_support_worker');

update companion.profiles p set sub_role_id = s.id
from companion.sub_roles s
where s.org_id = p.org_id and s.base_role = 'trusted_support_worker'
  and p.role = 'trusted_support_worker' and p.sub_role_id is null;

-- ── 2 · THE FLIP. role and sub_role_id move in ONE statement — a
--        second statement fails the composite FK.
update companion.profiles p
   set role = 'support_worker',
       sub_role_id = coalesce(
         (select tw.id from companion.sub_roles tw
           where tw.org_id = p.org_id and tw.base_role = 'support_worker'
             and lower(btrim(tw.name)) = 'trusted worker' and tw.archived_at is null),
         (select dflt.id from companion.sub_roles dflt
           where dflt.org_id = p.org_id and dflt.base_role = 'support_worker'
             and dflt.is_default and dflt.archived_at is null))
where p.role = 'trusted_support_worker';

update companion.invites i
   set role = 'support_worker',
       sub_role_id = coalesce(
         (select tw.id from companion.sub_roles tw
           where tw.org_id = i.org_id and tw.base_role = 'support_worker'
             and lower(btrim(tw.name)) = 'trusted worker' and tw.archived_at is null),
         (select dflt.id from companion.sub_roles dflt
           where dflt.org_id = i.org_id and dflt.base_role = 'support_worker'
             and dflt.is_default and dflt.archived_at is null))
where i.role = 'trusted_support_worker';

-- ── 3 · ASSERT before tightening ───────────────────────────────────
do $$
declare n_p bigint; n_i bigint; n_null bigint;
begin
  select count(*) into n_p from companion.profiles where role = 'trusted_support_worker';
  select count(*) into n_i from companion.invites  where role = 'trusted_support_worker';
  select count(*) into n_null from companion.profiles
    where role = 'support_worker' and org_id is not null and sub_role_id is null;
  if n_p > 0 or n_i > 0 then
    raise exception 'Flip incomplete: % profile(s), % invite(s) still hold the retired role', n_p, n_i;
  end if;
  if n_null > 0 then
    raise exception '% support_worker profile(s) have no sub-role — check ensure_default_sub_roles ran', n_null;
  end if;
end $$;

-- ── 4 · Tighten BOTH check constraints ─────────────────────────────
alter table companion.profiles drop constraint if exists profiles_role_check;
alter table companion.profiles
  add constraint profiles_role_check
  check (role in ('coordinator','support_worker','family','therapist','recipient'));

alter table companion.invites drop constraint if exists invites_role_check;
alter table companion.invites
  add constraint invites_role_check
  check (role in ('coordinator','support_worker','family','therapist','recipient'));

-- ── 5 · Drop the trusted-only policies ─────────────────────────────
-- Their replacement (069 step 8) is already live. Definitions captured
-- in inspect query I7 — that is the rollback record.
drop policy if exists "trusted workers can create support worker invites" on companion.invites;
drop policy if exists "trusted workers can view support worker invites"   on companion.invites;
-- Redundant even before retirement: "workers can log for assigned
-- clients" (013:167-172) has NO role test and the identical
-- client_ids_for_worker() predicate, so a plain support_worker already
-- holds this INSERT right. Dropping loses nothing.
drop policy if exists "trusted workers can log for assigned clients" on companion.log_entries;

-- ── 6 · Narrow the surviving IN-lists (behaviour-neutral now) ──────
drop policy if exists "workers can view own log entries" on companion.log_entries;
create policy "workers can view own log entries"
  on companion.log_entries for select
  using (public.my_role() = 'support_worker' and author_id = auth.uid());

-- storage.objects was NOT moved by 060 — do not qualify it as companion.
drop policy if exists "workers can view own journal photos" on storage.objects;
create policy "workers can view own journal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-photos'
    and public.my_role() = 'support_worker'
    and (string_to_array(name, '/'))[3] = auth.uid()::text
  );

drop policy if exists "workers can add feedback for assigned clients" on companion.client_feedback;
create policy "workers can add feedback for assigned clients"
  on companion.client_feedback for insert
  with check (
    author_id = auth.uid()
    and public.my_role() = 'support_worker'
    and client_id in (select public.client_ids_for_worker())
  );

drop policy if exists "can start timer for own client"   on companion.active_timers;
drop policy if exists "can replace timer for own client" on companion.active_timers;
drop policy if exists "can cancel timer for own client"  on companion.active_timers;

create policy "can start timer for own client"
  on companion.active_timers for insert
  with check (
    created_by = auth.uid() and org_id = public.my_org_id()
    and ( client_id in (select public.client_ids_for_recipient())
       or client_id in (select public.client_ids_for_family())
       or (public.my_role() = 'coordinator' and client_id in (select public.client_ids_for_org()))
       or (public.my_role() = 'support_worker'
           and client_id in (select public.client_ids_for_worker())) )
  );
create policy "can replace timer for own client"
  on companion.active_timers for update
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or (public.my_role() = 'support_worker'
        and client_id in (select public.client_ids_for_worker()))
  );
create policy "can cancel timer for own client"
  on companion.active_timers for delete
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or (public.my_role() = 'support_worker'
        and client_id in (select public.client_ids_for_worker()))
  );

-- can_view_log_entry stayed in `public` (not in 060's rpc_names list) but
-- 060's sweep rewrote its body. RECONCILE AGAINST I9 before running.
-- It gates the log_entry_comments policies (032:41/47) — a wrong body
-- silently breaks entry comments.
create or replace function public.can_view_log_entry(p_entry_id uuid)
returns boolean language sql stable security definer
set search_path = 'companion', 'public' as $$
  select exists (
    select 1 from companion.log_entries le
    where le.id = p_entry_id
      and ( (public.my_role() = 'support_worker' and le.author_id = auth.uid())
         or (le.org_id = public.my_org_id() and public.my_role() = 'coordinator')
         or (le.client_id in (select public.client_ids_for_family()))
         or (le.client_id in (select public.client_ids_for_recipient())) )
  )
$$;

-- 044's message policy reads pr.role OUT OF the profiles table, not
-- my_role(). It keeps working by luck after the flip (no row matches the
-- retired literal); narrow it anyway so the intent is legible.
drop policy if exists "org members can view messages" on companion.messages;
create policy "org members can view messages"
  on companion.messages for select
  using (
    org_id = public.my_org_id()
    and (
      sender_id = auth.uid() or recipient_id = auth.uid()
      or (recipient_id is null and public.my_role() in ('coordinator','family'))
      or (public.my_org_type() = 'family' and public.my_role() in ('coordinator','family'))
      or ( public.my_org_type() <> 'family'
           and public.my_role() = 'coordinator'
           and recipient_id is not null
           and exists (select 1 from companion.profiles pr
                       where pr.id in (sender_id, recipient_id)
                         and pr.role in ('coordinator','support_worker')) )
    )
  );

-- ── 7 · Rename the migrating twins, archive them, re-point ─────────
update companion.sub_roles
   set archived_at = coalesce(archived_at, now())
 where base_role = 'trusted_support_worker';

commit;

-- ── POST-071 · re-run the PARITY TEST from 070. Byte-identical
--    invite_members / invitable columns, and every role now
--    'support_worker'. That equality IS the proof of parity.
```

*(A short `072_cleanup` — drop the transitional `base_roles`/`role_permission_defaults`/`invite_ceiling` rows, drop the archived `trusted_support_worker` sub-roles, drop the `demote_member` trusted branch, drop the shim trigger, and finally `alter table companion.org_settings drop column permissions` — is deliberately left until after the bridge. That column drop is the point of no return: a frontend-only rollback is possible only while it exists.)*

## `073_bridge_add_entries.sql` — the bridge, as a template for one key

Ship **one key per deploy**. `add_entries` first: the matrix shows it is a genuine no-op for every role, and `log_entries` INSERT has **five** permissive policies (`013:167`, `013:179`, `013:188`→dropped, `030:18`, `056:15`) — the exact case where hand-auditing "did I get every policy" fails and a single restrictive policy cannot.

```sql
-- ═══════════════════════════════════════════════════════════════════
-- 073 · Bridge ONE key: add_entries -> RESTRICTIVE on log_entries INSERT
--
-- ⚠ THIS PROJECT HAS ZERO RESTRICTIVE POLICIES TODAY (grep across all
--   72 migrations: the word appears once, in a comment in 062). The
--   central enforcement mechanism is entirely unexercised here, on a
--   live app with real subscribers, no CI, and migrations pasted by
--   hand. This is the low-stakes first one. Verify the interaction with
--   the existing permissive set before betting another key on it.
--
-- PRE-FLIGHT, run BEFORE this file. Must return zero rows:
--   How many INSERTs in the last 30 days would the new predicate have
--   refused? A non-zero count is a person to notify, not a statistic.
--     select p.id, p.full_name, p.role, count(*) as would_have_been_refused
--     from companion.log_entries le
--     join companion.profiles p on p.id = le.author_id
--     where le.created_at > now() - interval '30 days'
--       and not coalesce((companion.permissions_for(p.id) ->> 'add_entries')::boolean, false)
--     group by 1,2,3 order by 4 desc;
--
-- The frontend's disabled state for add_entries MUST already be
-- deployed. A restrictive policy denies IN-FLIGHT writes: a worker with
-- an open journal composer taps save and the INSERT is refused. In a
-- care-notes app that is clinical-record loss.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- Postgres ANDs restrictive policies against the OR-union of ALL
-- permissive ones, so this covers every current and future permissive
-- INSERT policy on the table at once and cannot be bypassed by a sixth
-- one added later.
--
-- (select ...) not a bare call: the wrapped form is a constant-argument
-- expression the planner folds into an InitPlan evaluated ONCE PER
-- STATEMENT. The bare form risks per-row evaluation. This single
-- convention is the difference between one lookup per query and one per
-- row; `stable` is what makes the folding legal.
drop policy if exists "perm gate: log_entries insert" on companion.log_entries;
create policy "perm gate: log_entries insert"
  on companion.log_entries as restrictive for insert to authenticated
  with check ((select companion.has_perm('add_entries')));

update companion.permission_keys set enforced = true where key = 'add_entries';

commit;

-- ═══ POST-BRIDGE ASSERTIONS · all THREE must return zero rows ══════

-- A. kind vs permissive: a key marked 'gate' whose policy is permissive
--    would widen scope exactly as before; a 'grant' written restrictive
--    can never admit its rows.
select k.key, k.kind, p.schemaname, p.tablename, p.policyname, p.permissive
from   companion.permission_keys k
join   pg_policies p
  on   coalesce(p.qual,'') || coalesce(p.with_check,'')
       like '%has_perm(''' || k.key || ''')%'
where  (k.kind = 'gate'  and p.permissive <> 'RESTRICTIVE')
   or  (k.kind = 'grant' and p.permissive =  'RESTRICTIVE');

-- B. Every enforced key must appear in at least one policy. Catches the
--    single-character outage: has_perm('add_entrys') resolves to NULL ->
--    coalesce(false) -> a RESTRICTIVE policy that denies 100% of writes
--    to that table for all non-coordinators, with NO error anywhere.
select k.key from companion.permission_keys k
where  k.enforced
  and  not exists (
    select 1 from pg_policies p
    where coalesce(p.qual,'') || coalesce(p.with_check,'')
          like '%has_perm(''' || k.key || ''')%');

-- C. Any has_perm( call not wrapped in (select …) — per-row evaluation.
select schemaname, tablename, policyname
from   pg_policies
where  (coalesce(qual,'') || coalesce(with_check,'')) like '%has_perm(%'
  and  (coalesce(qual,'') || coalesce(with_check,''))
       not like '%( SELECT companion.has_perm%';
```

Remaining bridge order, one migration each, each with its own pre-flight count:
`074` `send_messages` (messages INSERT — single permissive policy; the one narrowing cell, recipients, no UI path) → `075` `edit_own_entry OR edit_any_entry` (log_entries UPDATE, **one** restrictive policy for both keys — they share a command, so two independent switches would silently be one) → `076` `delete_own_entry` → `077` `add_goals` → `078` `edit_own_goal OR edit_any_goal` → `079` `delete_own_goal` → `080` the `view_all_entries` **grant** (permissive, `client_ids_for_worker()` ceiling term unconditional and first).

---

# 3. THE ORDERED CODE CHANGES

**The order is forced, and it is: `068` → `069` → `070` → code → `071` → bridge.** Here is why neither alternative works, stated plainly.

- **Frontend before any migration = total lockout.** The new `usePermissions` calling `supabase.rpc('my_permissions')` against a database without the function gets `PGRST202`; react-query reports `isError`, `data === undefined`. Fail-closed on error denies everything. And because the coordinator ALLOW-ALL moves server-side, **coordinators are locked out too** — including out of `PermissionsPage`, the page they would need to fix it. This is the *likely* accident, since the frontend leg is the automated one (CI on push) and SQL is pasted by hand later. **Mitigation, mandatory: the client keeps an unconditional coordinator short-circuit before the query, and a `PGRST202` dual-read fallback to the legacy path.** With both in place, frontend-first degrades to "everyone sees the old behaviour" instead of "the app is dark".
- **`071` before the code = raw constraint violations on stale clients.** `sw.ts:20-23` calls `skipWaiting()` only on a message and `UpdatePrompt` needs a user tap, so an installed PWA runs the old bundle for an unbounded time. While `INVITE_MATRIX` and `MembersPage` still offer the role, tightening `invites_role_check` turns that path into a `check constraint violation` in the user's face. Hence the human-attestation gate at the top of `071`.

Everything before `071` is safe in either order **given the two client guards above**. `068`–`070` change no existing policy, no existing constraint, and no user-visible behaviour except `client_ids_for_worker()`'s org join (flagged in §2).

### Group A — safe to deploy at any time, before or after any migration

| File | Change | Why |
|---|---|---|
| `src/App.tsx:57-62` | Delete the stale comment claiming "*Updates apply silently … no user prompt*". | It contradicts `sw.ts:20-23` and `UpdatePrompt.tsx`. Someone will plan a rollout against it — the ops reviewer's F3 exists because of it. |
| `src/lib/roleHome.ts:5`; `src/pages/auth/SignIn.tsx:89`,`:132`; `SignUp.tsx:42`; `AcceptInvite.tsx:71`; `Step0Account.tsx:32`; `MessagesHub.tsx:105`; `MessageThread.tsx:179` | Collapse six duplicate copies of the worker-role→`/worker` decision into `roleHome()`/an exported `isWorkerRole()`. **Keep both role strings.** | `roleHome.ts`'s own docstring claims they are shared "*so they can't drift apart*"; they already have. Collapsing now means `071` touches one site, not eight. Narrowing the strings early is what fails **open**: `roleHome` falls to `/dashboard` → `RequireCoordinator` (`App.tsx:79-81`) → `/family` → `BlockWorker` (`:108`) no longer matches → the worker lands in the **family journal**. |
| `src/pages/auth/AcceptInvite.tsx:16-22` | Add a `trusted_support_worker` label. | Live bug: `:141` renders `ROLE_LABEL[invite!.role] ?? invite!.role`, so an invitee currently reads "Join *Org* as a **trusted_support_worker**". Reachable today — both coordinators (`MembersPage.tsx:398`) and family (`:404`) can send it. Fixing it now, rather than letting `071` fix it incidentally, means the fix is independent of the migration. |
| `src/pages/members/MembersPage.tsx:74` | `useState(allowedRoles[0] ?? …)` → an explicit safe default (`'support_worker'` when present). | For a trusted worker `allowedRoles[0]` is `'family'` (`:406-407`), which the backend 403s (`invite-member/index.ts:63`). Today a trusted worker who fills in name+email and sends **without touching the dropdown fails 100% of the time**. The same footgun reappears against sub-roles. |
| `src/pages/settings/PermissionsPage.tsx:120-133` | Make `save()` **merge** instead of replace. | `:97-103` builds `effective` from `CONFIGURABLE_ROLES` only and `:126` upserts it as the whole `permissions` column. Today that already erases stored `therapist` overrides on family orgs (`:76`) and any `recipient` overrides (never in any list). Once `trusted_support_worker` leaves `:10`, the first Save by any coordinator permanently deletes their stored trusted overrides. **This must be fixed, or `070` must have already run, before any `PermissionsPage` change ships.** |

### Group B — deploy after `070`, before `071` (the "dual-read" release)

Every file here tolerates **both** role strings and **both** permission sources.

| File | Change | Why |
|---|---|---|
| `src/hooks/usePermissions.ts` | Replace `DEFAULT_PERMS` values with `supabase.rpc('my_permissions')` (react-query, `staleTime: 60_000`). Keep the `PermissionKey` union — **names only, zero values**. Return `{status:'loading'\|'error'\|'ready', perms}`. **Keep `if (role === 'coordinator') return COORDINATOR_PERMS` unconditionally, before the query.** On `PGRST202`, fall back to the existing `org_settings.permissions` + `DEFAULT_PERMS` path. Add a dev-only assertion comparing the union against `companion.permission_keys`. | The app and RLS then consume **the same function over the same rows**, so TS↔SQL drift is not "prevented", it is unrepresentable. The coordinator short-circuit guarantees the people who can fix things are never the ones locked out. `isError ≠ isLoading` — the precedent for fail-closed in this repo is `RequireFeature` (`App.tsx:112+`), which gates one feature; this gates the whole app. |
| `src/pages/settings/PermissionsPage.tsx` | Data-driven off `permission_keys` + `role_permission_defaults` + `sub_roles`. Delete `ALL_CONFIGURABLE_ROLES` (`:8-13`) and `PERM_KEYS` (`:56-66`). Add sub-role CRUD (`create_sub_role`/`update_sub_role`/`archive_sub_role`/`delete_sub_role`). Render a **ceiling-disabled** state for any key where `max_allowed = false`. Label the five decorative cells (§1) as "not yet enforced". | Deletes the hardcoded arrays and the destructive whole-object upsert in one move. A switch the database refuses is worse than no switch. |
| `src/pages/members/MembersPage.tsx` | `invitableRoles` (`:389-420`) → `supabase.rpc('my_invitable_roles')`, keeping only the plan/seat filters (`:413-419`). Replace `↑ Trust` (`:585`) and `↓` (`:597`) with a sub-role picker calling `assign_sub_role`. Add a sub-role chip to the member row. Simplify `:378`/`:416`/`:57` to one worker role **after** `071`, not now. | The 403-guaranteed frontend list (`:406-407`, `:409`) dies with it. Retiring the green `#2e7d52` badge (`:32`) removes the **only** at-a-glance elevation cue on the Members list — the chip is new UI, not a rename, and should be scoped as such. `⭐` currently means trusted in `PermissionsPage.tsx:10` and coordinator in `MessagesHub.tsx:160`; pick one. |
| `src/components/InviteModal` (in `MembersPage.tsx`) | Add an optional sub-role select, dependent on the chosen role; send `sub_role_id` in the `invite-member` body. | Otherwise a coordinator cannot invite someone *as* a Trusted worker and must invite-then-promote. |
| `supabase/functions/invite-member/index.ts` | Destructure `sub_role_id` at `:41`. **Delete `INVITE_MATRIX` (`:60-64`)**; instead call `admin.rpc('invitable_roles_for', { p_user_id: user.id })` and require `role` ∈ that set. Validate `sub_role_id` belongs to `org_id` **and** matches `role`. Add `sub_role_id` to the `:94` insert. Resolve `roleLabel` from the sub-role name when present. | **The `:94` insert enumerates columns explicitly, so a `sub_role_id` added to the request body without touching that line is SILENTLY DROPPED** — the invite sends fine and the sub-role vanishes. This is the single most likely way to half-ship the feature. And this function builds `admin = createClient(url, serviceKey)`, which has BYPASSRLS and checks only `INVITE_MATRIX[caller.role]` — it never reads `invite_members` at all. Every permission enforced only by RLS is bypassed by every service-role edge function that writes the gated table; this one and `redeem-invite` are the live instances. Switching to `invitable_roles_for` is safe pre-`071` because the transitional ceiling row still serves trusted holders. |
| `supabase/functions/redeem-invite/index.ts:75-80` | Add `sub_role_id: invite.sub_role_id` to the upsert. | This is the **new-user** acceptance path — the common one; `accept_invite` only serves users who already have an account. `MATCH SIMPLE` with `sub_role_id` NULL raises no error, so the invitee **silently loses the sub-role the coordinator assigned** and falls to the org default: a "Trusted worker" invitee lands with `invite_members: false`. Also collapse `:90`'s `['support_worker','trusted_support_worker']` **after** `071`. |
| `supabase/functions/auto-register/index.ts:74-79` | Add `sub_role_id: null` to the upsert. | Safe today (fresh user), defensive against a re-run against an existing row. |
| `src/types/database.ts` | Add the new tables/RPCs. Add `sub_role_id` to `profiles`/`invites`. **Keep `trusted_support_worker` in the `Role` union**, marked deprecated. | `lookup_invite` (`:904`) and `get_org_members` (`:933`) type `role` as plain `string`, so removing the union member surfaces nothing at compile time — it just stops type-checking residual DB values. Remove it only after `071` is verified live. |

### Group C — after `071` is verified live

Narrow every remaining two-string check to one: `roleHome.ts:5`, `App.tsx:81/108/141`, `SignIn.tsx:89/132`, `SignUp.tsx:42`, `AcceptInvite.tsx:71`, `Step0Account.tsx:32`, `MessagesHub.tsx:105/162`, `MessageThread.tsx:179/20`, `MembersPage.tsx:20/25/32/57/285/378/398/404/416`, `ClientManagePanel.tsx:96`, `CoordinatorDashboard.tsx:86`, `redeem-invite/index.ts:90`, `types/database.ts:5`. Also delete `MembersPage.tsx:285`'s pending-invites `enabled` list entry (already dead — the render is gated `isCoordinator || isFamily` at `:460`), and update the stale docs at `CLAUDE.md:9` and `MAB-HANDOFF.md:81/85` (line 85 poses this very retirement as an open question).

### Group D — with each bridge migration, **before** its policy

For each key, ship the frontend's disabled/hidden state first, so the control disappears rather than the save failing. Add a local-draft-on-failure path to the journal composer: `AuthContext.tsx:96-110` rehydrates the profile on every `onAuthStateChange` carrying a session (including `TOKEN_REFRESHED`), so a permission change lands at an arbitrary moment mid-task.

---

# 4. WHAT IS DELIBERATELY NOT DONE

1. **DB-side entitlement gating.** RLS enforces **WHO**, never **WHETHER**. `052_retention_by_entitlement.sql:12-17` says it outright and neutralises a server purge for exactly that reason; entitlements resolve through the `check-features` edge function (`src/lib/features.ts`). So after the bridge, `add_goals` RLS will permit an insert for an org whose plan lacks `FEATURES.goals`. That is not a regression — it is already true — but the phrase "enforced at the database level" becomes half-true and must be written down in `CLAUDE.md`. Doing it properly needs a webhook-synced entitlement cache on `organisations` (the pattern exists for `plan`/`seats`/`metered_axis`). Separate project.
2. **The plan/seat bypass in `invite-member`.** That function has **no** plan check and **no** seat check — only the org match (`:53`) and the role matrix (`:65-67`). So the frontend's `canInviteRecipient`/`canInviteTherapist`/`workerCapReached` filters (`MembersPage.tsx:413-419`) are bypassable by replaying the request the UI already makes. This is the disagreement that loses revenue, and it is orthogonal to sub-roles. Flagged, not fixed.
3. **Sub-roles for `family`, `therapist`, `recipient`** (`sub_roles_allowed = false`, PO decision D2). One base role on day one; the flag makes each addition a one-row change.
4. **The five decorative matrix cells.** `therapist.view_all_entries`, `therapist.add_goals`, `therapist.edit_own_goal`, `therapist.delete_own_goal` (a therapist has **no** policy on `log_entries` or `participant_goals` at all) and `family.edit_any_entry` (`067:15` allows only author or coordinator). Bridging any of them as a permissive policy would be a **new grant**, not enforcement. They stay unenforced; the UI must say so.
5. **Permission coverage for eleven other tables.** The vocabulary governs only `log_entries`, `messages`, `invites`, `participant_goals`. **Ungated by this model**: `behaviour_notes`, `incidents`, `day_notes`, `medications`, `medication_logs`, `client_feedback`, `recipient_moods`, `schedule_items`, `ndis_records`, `log_entry_comments`, `log_entry_reactions`, `goal_progress_records`. A coordinator reading "Add journal entries: off" will reasonably believe the worker cannot write clinical records; they can still file a **behaviour note** and an **incident**. `PermissionsPage`'s help text and `CLAUDE.md` must say which tables the keys govern. Extending the vocabulary is a follow-up.
6. **`delete_any_entry` / `delete_any_goal`.** Only the `_own` delete keys are added, seeded to exactly today's behaviour. Adding `_any` variants would create switches with no matching policy.
7. **Retiring `promote_member`/`demote_member` entirely.** `promote_member` keeps its family→coordinator branch; `demote_member` keeps its coordinator→family branch and its trusted→support_worker branch (harmless — it performs exactly the conversion `071` performs). The trusted branch goes in cleanup.
8. **Dropping `org_settings.permissions`.** It is the irreversibility boundary: a frontend-only rollback (the only one-click revert available) is safe **only while that column still exists**. It survives through the bridge, kept alive by the forward-compat shim.
9. **A materialised complete permission set per sub-role.** Attractive as an optimisation but incomplete alone: the moment a new key is added, existing rows lack it and you need the defaults fallback anyway. The left join over `role_permission_defaults` is 2 index lookups plus an 11-row scan.
10. **Any automated test.** Per `E:\companion\CLAUDE.md` this repo has no CI and migrations are pasted by hand. A test that needs live DB credentials and is never run is worse than no test — it manufactures false confidence. The assertions are inline in the SQL and in §5 instead.

---

# 5. THE VERIFICATION STEPS

## 5.1 Structural — run in the SQL editor after `068`

All must return **zero rows**: assertions A/B/C at the end of `068`. If B returns anything other than `SELECT`, **stop** — the design is strictly worse than the status quo until it is empty.

```sql
-- Prove the resolution function is what the RLS layer will actually use.
select p.full_name, p.role, s.name as sub_role,
       companion.permissions_for(p.id) as resolved,
       array(select companion.invitable_roles_for(p.id)) as invitable
from   companion.profiles p
left   join companion.sub_roles s on s.id = p.sub_role_id
where  p.org_id = '<an org id>'
order  by p.role, p.full_name;

-- Prove the ceiling holds even against a hand-written row (this is the
-- read-time half, which survives a service-role write or a SQL-editor edit).
begin;
  insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
  values ('<a support_worker sub-role id>', 'edit_any_entry', true);
  -- Expect: ERROR  permission edit_any_entry exceeds the ceiling for this base role
rollback;

-- And prove read-time clamping independently, by bypassing the trigger:
begin;
  alter table companion.sub_role_permissions disable trigger sub_role_perm_ceiling;
  insert into companion.sub_role_permissions (sub_role_id, permission_key, allowed)
  values ('<same id>', 'edit_any_entry', true);
  -- MUST still be false: the clamp is `stored AND max_allowed`.
  select companion.permissions_for('<a member of that sub-role>') ->> 'edit_any_entry';
rollback;

-- Prove immutability and the absence of a cascade primitive.
begin;
  update companion.sub_roles set base_role = 'family' where id = '<id>';
  -- Expect: ERROR  sub_roles.base_role is immutable
rollback;

-- Prove a detached profile resolves to deny-all, not ALLOW-ALL.
select companion.permissions_for(id)
from   companion.profiles where org_id is null limit 5;   -- expect {}

-- Prove org deletion still works (the RESTRICT/SET NULL interaction).
begin;
  delete from companion.organisations where id = '<a disposable test org>';
rollback;
```

## 5.2 Enforcement — the direct-API calls that MUST be rejected

RLS is only proven from outside the app. Get an `access_token` for a real non-coordinator (sign in via `/auth/v1/token?grant_type=password`), then — **the `Content-Profile`/`Accept-Profile: companion` header is mandatory**, or PostgREST looks in `public` and you will get a misleading 404 that proves nothing.

```bash
URL=https://<ref>.supabase.co
ANON=<anon key>
JWT=<a support_worker's access_token>
H=( -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" )
```

**① The headline test — a worker raising their own sub-role's permissions.** This is the call the whole design exists to refuse. It must fail on **privilege**, not on RLS, because there is no UPDATE grant at all.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH \
  "$URL/rest/v1/sub_role_permissions?sub_role_id=eq.<their own sub-role>&permission_key=eq.invite_members" \
  "${H[@]}" -H "Content-Profile: companion" \
  -d '{"allowed": true}'
```
**Expect `401` with `"permission denied for table sub_role_permissions"`.** A `200`, a `204`, or `PGRST116` means §5.1 assertion B was skipped — **stop the rollout**.

**② The same attack one level up — raising the ceiling for every tenant on the platform.** `role_permission_defaults` has no `org_id`, so a single worker in a single org editing it would raise the ceiling globally. This is simultaneously the escalation hole and the cross-tenant hole.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH \
  "$URL/rest/v1/role_permission_defaults?base_role=eq.support_worker&permission_key=eq.edit_any_entry" \
  "${H[@]}" -H "Content-Profile: companion" \
  -d '{"max_allowed": true, "default_allowed": true}'
```
**Expect `401 permission denied for table role_permission_defaults`.**

**③ Self-assignment to a higher sub-role.** The composite FK is *satisfied* here — same org, same base role — so only the RPC's own authorization check refuses it.

```bash
curl -sS -X POST "$URL/rest/v1/rpc/assign_sub_role" \
  "${H[@]}" -H "Content-Profile: companion" \
  -d '{"p_user_id":"<their own uid>","p_sub_role_id":"<the Trusted worker sub-role id>"}'
```
**Expect `{"code":"P0001","message":"forbidden"}`.**

**④ Cross-tenant reassignment.** The `org_id = my_org_id()` check on the *argument* is the one people forget; without it this mass-reassigns a stranger's staff.

```bash
curl -sS -X POST "$URL/rest/v1/rpc/delete_sub_role" \
  "${H[@]}" -H "Content-Profile: companion" \
  -d '{"p_id":"<another org'\''s sub-role>","p_reassign_to":"<another org'\''s other sub-role>"}'
```
**Expect `forbidden` (worker) or `not_in_your_org` (coordinator of a different org).**

**⑤ Reading another user's resolved permission map.**

```bash
curl -sS -X POST "$URL/rest/v1/rpc/permissions_for" \
  "${H[@]}" -H "Content-Profile: companion" -d '{"p_user_id":"<any other uid>"}'
```
**Expect `PGRST202` / `permission denied for function permissions_for`** — it is revoked from `authenticated` and granted only to `service_role`.

**⑥ Cross-tenant sub-role read.**

```bash
curl -sS "$URL/rest/v1/sub_roles?select=id,org_id,name" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JWT" -H "Accept-Profile: companion"
```
**Expect only their own `org_id`.** Any other org's row means the SELECT policy is missing.

**⑦ The permission gate itself — after `073` ships.** Set that worker's sub-role `add_entries = false` (via the coordinator UI), then, as the worker:

```bash
curl -sS -X POST "$URL/rest/v1/log_entries" \
  "${H[@]}" -H "Content-Profile: companion" \
  -d '{"org_id":"<their org>","client_id":"<a client they ARE assigned to>",
       "author_id":"<their uid>","entry_type":"note","notes":"rls probe"}'
```
**Expect `42501` — `new row violates row-level security policy for table "log_entries"`.** A `201` means the restrictive policy is not in force. **This is the call that distinguishes "enforced at the database level" from "hidden in the UI"** — the participant is correctly assigned and every permissive policy admits the row; only the restrictive gate refuses it. Then flip `add_entries` back on and repeat: it must return `201`. Both halves are required — a policy that always denies looks identical to a working one if you only run the negative test.

**⑧ The legacy escalation that must NOT have reappeared.**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH \
  "$URL/rest/v1/profiles?id=eq.<their own uid>" \
  "${H[@]}" -H "Content-Profile: companion" \
  -d '{"sub_role_id":"<the Trusted worker sub-role id>"}'
```
**Expect `401 permission denied for table profiles`** — `047` revoked column UPDATE and granted only `(full_name, phone)`; `sub_role_id` was never added to that grant.

**⑨ The dormant RPC.** Prove `069`'s revoke landed:

```bash
curl -sS -X POST "$URL/rest/v1/rpc/remove_member" \
  "${H[@]}" -H "Content-Profile: public" -d '{"p_user_id":"<any uid>"}'
```
**Expect `permission denied for function remove_member`.** Note the `Content-Profile: public` — the app's client is schema-pinned to `companion`, which is exactly why this one was invisible.

## 5.3 Performance — before any bridge migration ships

```sql
explain (analyze, buffers)
select * from companion.log_entries where client_id = '<a client with ~500 entries>';
```
Run as a worker (`set role authenticated; set request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';`). `companion.has_perm` must appear as an **InitPlan / one-time filter**, not once per row. If it does not, `073`'s `(select …)` wrapper was dropped somewhere — assertion **C** catches it.

## 5.4 Residual risk after all of this

Stated honestly, in descending order:

1. **Zero restrictive policies exist in this project today.** The central enforcement mechanism is unexercised, on a live app with real subscribers, no CI, and migrations pasted by hand. `073` is the smallest possible first exposure and it is still real risk.
2. **The five decorative cells and twelve ungated tables** mean "permissions" remains partially aspirational after this pass. A coordinator can reasonably misread what a switch does. Documentation is the only mitigation shipped here.
3. **The stale-PWA window is unbounded.** The forward-compat shim removes the *silent no-op* failure mode; it does not make old clients correct. Until every installed PWA has tapped Refresh, two permission systems coexist and only the shim keeps them consistent.
4. **`069`'s six rewritten function bodies are reconstructions.** `060`'s sweep rewrote what is deployed; the migration files no longer match. Inspect query I9 is the truth, and `setup_family_org` in particular is the one most likely to differ from the reconstruction above. Diff before committing.
5. **The `client_ids_for_worker()` org join in `069` is the one behaviour change in an otherwise-neutral migration.** Run the population query first.
6. **`invite-member` still bypasses plan and seat limits** (§4 item 2). Unrelated to sub-roles, unfixed, and it is the one that costs money.
7. **The `edit_own`/`edit_any` shared-command restriction means the UI shows two switches for one setting.** `075` handles it correctly at the DB layer (one restrictive policy, disjunctive predicate), but a coordinator who sets `edit_own_entry: false, edit_any_entry: true` will get a sub-role that can edit nothing until the UI is taught the dependency. That teaching is in Group B and is easy to forget.

**Files referenced (all absolute, none modified):** `E:\companion\supabase\migrations\001_organisations_profiles.sql`, `003_log_entries.sql`, `005_messages_invites.sql`, `006_fix_rls_recursion.sql`, `011_family_plan.sql`, `012_roles_org_type.sql`, `013_fix_clients_rls_recursion.sql`, `014_fix_setup_family_org_role.sql`, `023_log_entries_delete.sql`, `026_recipient_role.sql`, `030_recipient_journal_access.sql`, `032_own_entry_edit_and_reactions.sql`, `041_therapist_invite_and_decision_maker.sql`, `044_message_visibility_by_org_type.sql`, `047_security_profile_update_lockdown.sql`, `049_coordinator_edit_member.sql`, `052_retention_by_entitlement.sql`, `056_coordinator_log_entries.sql`, `058_collaborative_goals.sql`, `060_companion_schema.sql`, `066_open_timer_to_workers.sql`, `067_coordinator_edit_any_entry.sql`; `E:\companion\supabase\functions\invite-member\index.ts`, `redeem-invite\index.ts`, `auto-register\index.ts`; `E:\companion\src\hooks\usePermissions.ts`, `src\pages\settings\PermissionsPage.tsx`, `src\pages\members\MembersPage.tsx`, `src\lib\supabase.ts`, `src\lib\roleHome.ts`, `src\App.tsx`, `src\sw.ts`, `src\context\AuthContext.tsx`, `src\components\FamilyBottomNav.tsx`, `src\types\database.ts`.