-- ─────────────────────────────────────────────────────────────
-- 060 · Move Companion into its own `companion` schema
--
-- This project is becoming a shared "MABApps" hub for multiple products.
-- Companion's ~30 tables move out of the shared `public` schema into a
-- dedicated `companion` schema, so future apps can each get their own
-- schema in the same project without name collisions — while still
-- sharing one `auth.users`, one API host, one set of edge functions.
--
-- What survives a schema move automatically (Postgres tracks these by the
-- table's OID, not its name/schema):
--   - RLS policies, including ones on OTHER tables that reference a moved
--     table in their USING/WITH CHECK clause (e.g. participant_goals'
--     policies referencing client_family)
--   - GRANTs (select/insert/update/delete to authenticated etc.)
--   - Triggers attached to the table, foreign keys, indexes
--   - Realtime publication membership (pg_cron jobs and Realtime
--     subscriptions are addressed separately below — those aren't
--     OID-bound)
--
-- What does NOT survive automatically and is handled explicitly below:
--   - Function/trigger-function BODIES with an explicit "public.<table>"
--     reference (PL/pgSQL and SQL-language functions store literal query
--     text, re-resolved by name at each call — not by OID) — fixed via
--     a generic sweep over every function's live definition, not a
--     hand-reconstructed guess from migration history.
--   - The small set of functions actually invoked as RPCs from the app
--     (supabase.rpc(...)) — moved into `companion` too, so a client
--     configured with db.schema = 'companion' can find them the same way
--     it finds tables.
--   - Any pg_cron job command referencing a moved table by name (belt and
--     suspenders — the one active job here, timer-alerts-dispatch, only
--     calls an edge function over HTTP and needs no change, but this
--     guards against any ad-hoc job created outside a tracked migration).
--
-- App-side changes made alongside this migration (not in this file):
--   - src/lib/supabase.ts: client now targets db.schema = 'companion'
--   - src/types/database.ts: the Database type's top-level key renamed
--     from `public` to `companion`
--   - Every edge function that queries these tables: same db.schema option
--   - Every supabase.channel(...).on('postgres_changes', { schema: ... })
--     realtime subscription: schema updated from 'public' to 'companion'
--
-- Manual steps only possible from the Supabase Dashboard (not this file):
--   1. Settings → API → Exposed schemas: add `companion` (PostgREST will
--      404 on companion.* requests until this is set)
--   2. Settings → General → Project name: rename to MABApps, if desired
-- ─────────────────────────────────────────────────────────────

begin;

create schema if not exists companion;
grant usage on schema companion to anon, authenticated, service_role;
alter default privileges in schema companion grant select, insert, update, delete on tables to authenticated;

-- ── Move every table ─────────────────────────────────────────
alter table if exists public.organisations               set schema companion;
alter table if exists public.clients                      set schema companion;
alter table if exists public.profiles                     set schema companion;
alter table if exists public.invites                      set schema companion;
alter table if exists public.client_family                set schema companion;
alter table if exists public.client_workers               set schema companion;
alter table if exists public.client_circle                set schema companion;
alter table if exists public.messages                     set schema companion;
alter table if exists public.log_entries                  set schema companion;
alter table if exists public.notices                      set schema companion;
alter table if exists public.log_entry_comments           set schema companion;
alter table if exists public.log_entry_reactions          set schema companion;
alter table if exists public.schedule_items               set schema companion;
alter table if exists public.schedule_item_completions    set schema companion;
alter table if exists public.schedule_item_skips          set schema companion;
alter table if exists public.schedule_item_notes          set schema companion;
alter table if exists public.timer_alerts                 set schema companion;
alter table if exists public.active_timers                set schema companion;
alter table if exists public.recipient_moods              set schema companion;
alter table if exists public.behaviour_notes              set schema companion;
alter table if exists public.note_shares                  set schema companion;
alter table if exists public.access_log                   set schema companion;
alter table if exists public.incidents                    set schema companion;
alter table if exists public.participant_goals            set schema companion;
alter table if exists public.goal_progress_records        set schema companion;
alter table if exists public.client_feedback               set schema companion;
alter table if exists public.client_feedback_comments      set schema companion;
alter table if exists public.push_subscriptions           set schema companion;
alter table if exists public.org_photo_keys                set schema companion;
alter table if exists public.org_settings                  set schema companion;

-- ── Move the RPC-callable functions actually invoked as
--    supabase.rpc(...) from the app, so a schema-targeted client finds
--    them the same way it finds tables. Everything else (my_org_id,
--    my_role, trigger functions, etc.) stays in `public` — RLS policies
--    reference those explicitly as public.my_role() etc., and moving
--    them would mean re-editing every policy for no benefit.
do $$
declare
  rpc_names text[] := array[
    'accept_invite', 'check_pending_invite', 'create_organisation',
    'demote_member', 'get_org_members', 'lookup_invite',
    'promote_member', 'setup_family_org', 'update_member'
  ];
  fname text;
  r record;
begin
  foreach fname in array rpc_names loop
    for r in
      select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fname
    loop
      execute format('alter function %s set schema companion', r.oid::regprocedure);
    end loop;
  end loop;
end $$;

-- ── Fix every function body (wherever it now lives) that explicitly
--    references a moved table as "public.<table>". Reads each function's
--    OWN CURRENT definition via pg_get_functiondef (not a hand-traced
--    guess across 59 migrations' history) and rewrites only the table
--    references, then re-creates it in place.
do $$
declare
  table_names text[] := array[
    'organisations','clients','profiles','invites','client_family',
    'client_workers','client_circle','messages','log_entries','notices',
    'log_entry_comments','log_entry_reactions','schedule_items',
    'schedule_item_completions','schedule_item_skips','schedule_item_notes',
    'timer_alerts','active_timers','recipient_moods','behaviour_notes',
    'note_shares','access_log','incidents','participant_goals',
    'goal_progress_records','client_feedback','client_feedback_comments',
    'push_subscriptions','org_photo_keys','org_settings'
  ];
  tname text;
  fixed_def text;
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'companion') and p.prokind = 'f'
  loop
    fixed_def := pg_get_functiondef(r.oid);
    foreach tname in array table_names loop
      fixed_def := regexp_replace(fixed_def, '\mpublic\.' || tname || '\M', 'companion.' || tname, 'g');
    end loop;
    -- Safety net: every convention seen in this codebase schema-qualifies
    -- table references explicitly (e.g. "public.profiles"), which the
    -- substitution above already handles — but if any function relies on
    -- an unqualified name resolved via its own "search_path = public"
    -- clause instead, put `companion` ahead of `public` in that search
    -- path too, so a reference this sweep didn't textually catch still
    -- resolves correctly rather than failing at the function's next call.
    fixed_def := regexp_replace(fixed_def, 'search_path\s*=\s*public\M', 'search_path = companion, public', 'g');
    execute fixed_def;
  end loop;
end $$;

-- ── Belt and suspenders: fix any pg_cron job command text referencing a
--    moved table by name (none currently do, but this guards against any
--    job created ad-hoc outside a tracked migration, the same way the
--    `notices` table itself once was).
do $$
declare
  table_names text[] := array[
    'organisations','clients','profiles','invites','client_family',
    'client_workers','client_circle','messages','log_entries','notices',
    'log_entry_comments','log_entry_reactions','schedule_items',
    'schedule_item_completions','schedule_item_skips','schedule_item_notes',
    'timer_alerts','active_timers','recipient_moods','behaviour_notes',
    'note_shares','access_log','incidents','participant_goals',
    'goal_progress_records','client_feedback','client_feedback_comments',
    'push_subscriptions','org_photo_keys','org_settings'
  ];
  tname text;
  r record;
  fixed_cmd text;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for r in select jobid, command from cron.job loop
      fixed_cmd := r.command;
      foreach tname in array table_names loop
        fixed_cmd := regexp_replace(fixed_cmd, '\mpublic\.' || tname || '\M', 'companion.' || tname, 'g');
      end loop;
      if fixed_cmd <> r.command then
        perform cron.alter_job(r.jobid, command => fixed_cmd);
      end if;
    end loop;
  end if;
end $$;

commit;
