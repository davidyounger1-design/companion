# Companion

An NDIS care-coordination PWA. React + TypeScript + Vite, Supabase (Postgres/Auth/Edge Functions/RLS), @tanstack/react-query, react-router-dom. Deployed to `companion.myappbuddy.com.au` via GitHub Actions (`.github/workflows/deploy.yml`) on every push to `master`.

Companion is one product inside a shared Supabase project ("MABApps") that also hosts other apps — this is why its tables live in a dedicated `companion` Postgres schema rather than `public` (see below).

## Roles and org types

Profile roles: `coordinator`, `family`, `recipient`, `support_worker`, `trusted_support_worker`, `therapist`.

`organisations.org_type` is either:
- `'family'` — a single participant, no formal coordinator/team structure; typically run day-to-day by family.
- `'provider'` — multiple participants, a real coordinator/team structure.

A recurring pattern: a feature is coordinator-only by default, then later gets opened up to `family` role *but only on `org_type = 'family'` orgs* — provider orgs keep the stricter rule. Check `public.my_org_type()` when writing a new permission split like this.

## Supabase: nothing auto-deploys except the frontend

Only the frontend deploys via CI. Both of these are **manual, dashboard-driven steps the user does after you hand them SQL/code** — always flag this explicitly after shipping either:

- **Migrations** (`supabase/migrations/*.sql`): never run automatically. Give the user the raw SQL to paste into the Supabase SQL editor. Number them sequentially, write them idempotently (`if not exists` / `drop policy if exists` before `create policy`).
- **Edge functions** (`supabase/functions/*/index.ts`): deployed by pasting the single file into the Supabase Dashboard's function editor. **That editor does not bundle `_shared/` or any relative import** — a function that imports from `../_shared/foo.ts` will fail to deploy with "Module not found". Inline any shared helper code directly into the function file instead (convention: a comment noting "Inlined from _shared/X.ts so this function deploys as a single file" — see `check-plan/index.ts`, `sync-subscription/index.ts`, `timer-alert-notify/index.ts` for examples).
- Edge functions should return HTTP 200 always, with an `{ ok: boolean, error?: string }` body, rather than a non-2xx status — `supabase.functions.invoke()` swallows the response body on non-2xx statuses, making errors invisible client-side.

## The `companion` schema — read this before writing any migration

All of Companion's ~30 tables live in the `companion` Postgres schema (moved out of `public` in migration `060_companion_schema.sql`, to make room for other MABApps products). This has a sharp, easy-to-miss edge:

**Bare table names in a migration's raw SQL resolve against the SQL editor session's own `search_path`, which is `public` — not `companion`.** A migration that writes `on notices` or `alter table log_entries ...` without the `companion.` prefix will fail (or silently target the wrong thing if a same-named table exists there) once run. **Always schema-qualify**: `companion.log_entries`, `on companion.notices`, etc., in every new migration.

This bit us for real: migration `062_notices_family_can_post_and_edit.sql` was originally written with bare `notices` and had to be fixed before the user ran it, because it would have errored with "relation notices does not exist".

Helper functions (`public.my_org_id()`, `public.my_role()`, `public.my_org_type()`, `public.client_ids_for_family()`, `public.client_ids_for_recipient()`, `public.client_ids_for_org()`, etc.) deliberately **stayed in `public`** during the schema move — RLS policies reference them as `public.my_role()` etc. Their function bodies were swept to reference `companion.*` tables internally and their `search_path` was set to `'companion', 'public'`, so they resolve bare table names inside their own body correctly — but that only applies inside the function's own execution, not to the outer migration DDL calling it.

The frontend Supabase client (`src/lib/supabase.ts`) is configured with `db.schema: 'companion'`, and `src/types/database.ts`'s `Database` type has its top-level key as `companion` (not `public`). Every edge function that queries these tables passes `db: { schema: 'companion' }` explicitly when constructing its own `createClient()` — it does not inherit the frontend's config.

One RPC-enumeration gotcha from this move: if you ever need to find every `supabase.rpc('name')` call site (e.g. auditing which RPCs need a schema move), a naive regex like `\.rpc\('[a-z_]+'` will miss call sites with a cast in between, e.g. `(supabase.rpc as any)('get_or_create_photo_key')`. Use a looser pattern (`\.rpc[^(]*\('[a-z_]+'`) and verify against every match.

## Git workflow

Develop on the assigned branch (currently `claude/tender-cerf-yw3fzd`), never push elsewhere without explicit permission.

Standard cycle per change: edit → `npm run build` (must be zero TS errors) → bump the patch version in `package.json` → `git add` specific files (never `-A`) → commit → `git push -u origin <branch>` → open a PR (base `master`) → squash-merge → poll `https://companion.myappbuddy.com.au/version.json` for the new version **and** proactively check the actual `deploy.yml` job status via GitHub Actions (don't just wait out the polling timeout) → tell the user which manual Supabase steps (migrations / edge functions) are still needed.

**Squash-merge divergence — the single biggest recurring gotcha in this repo.** Every PR merges via `merge_method: 'squash'`, so each merge produces a brand-new commit hash on `master`, unrelated to the feature branch's own pre-squash commit history. When you next `git merge origin/master` on a continuing branch:
- You will almost always get a trivial conflict on `package.json`'s `version` field — always keep HEAD's (your branch's) version, discard master's.
- You can occasionally get something much worse: git's 3-way merge can **resurrect code you deliberately deleted in a later commit**, because it sees master's squashed content (which still has the old code, from before your deletion was squash-merged) as new/authoritative relative to a merge-base that predates your deletion. This has happened more than once in this repo (a resurrected Goals accordion in `FamilyDashboard.tsx`; a resurrected `PhotoThumbnailBackfillCard` block in `DisplaySettings.tsx`).
- **Recovery procedure**: after resolving any merge conflict, `grep` for anything you know you'd previously and deliberately deleted and re-delete it if it reappeared, confirm zero leftover `<<<<<<<`/`=======`/`>>>>>>>` markers anywhere, rebuild clean, then commit the merge and retry the PR merge.

**GitHub Actions deploy flake**: the "Set up Hostinger SSH key" step in `deploy.yml` occasionally fails to reach Hostinger for the host-key scan (transient, unrelated to the code). Recognizable by that specific step failing while the build/checkout steps succeeded. Fix: `mcp__github__actions_run_trigger` with method `rerun_failed_jobs` — no further investigation needed, this is a known, characterized flake.

**Large Actions API responses**: `mcp__github__actions_list` (`list_workflow_runs`/`list_workflow_jobs`) frequently exceeds the tool's response size limit; it auto-saves the full JSON to a file and returns the path. Don't load that file into context — extract only the fields you need via a short `python3 -c "import json; ..."` snippet (e.g. `id`, `head_sha`, `status`, `conclusion`).

## Photo encryption

Journal photos are client-side AES-256-GCM encrypted (`src/lib/photoEncryption.ts`). Layout: `MAGIC(4) | IV(12) | GCM-ciphertext`, magic bytes `0x45 0x4e 0x43 0x01` ("ENC\x01") let the code detect legacy unencrypted photos and serve them as-is. The key is a per-org hex string from `supabase.rpc('get_or_create_photo_key')`, cached via `usePhotoKey()` (`staleTime: Infinity`). Photos also get a small client-generated JPEG thumbnail (`createImageThumbnail`, `log_entries.photo_thumb_path`) so the journal feed previews load fast on a slow connection — the full photo only downloads when a viewer opens the lightbox.

## Never do

- Never accept a pasted live secret key in chat.
- Never push to a branch other than the one assigned, without explicit permission.
- Never run destructive git operations without confirming first.
