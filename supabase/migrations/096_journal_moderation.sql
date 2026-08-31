-- ═══════════════════════════════════════════════════════════════════
-- 096 · Journal moderation  (idempotent)
--
-- Org-level opt-in: when companion.org_settings.feature_flags ->>
-- 'journal_moderation' = 'true', a support_worker-authored log_entries
-- row is force-set to status = 'pending' on INSERT (server-side —
-- never trusted from the client) and stays invisible to family/
-- recipient until a coordinator or a holder of the new 'moderate_entries'
-- permission releases or hides it. Family/coordinator/recipient-authored
-- entries, and worker entries in orgs with the flag off, are always
-- 'released' — this feature narrows worker-entry visibility only, it
-- never widens anything.
--
-- 'moderate_entries' rides the existing sub-role/permission engine from
-- 068-072 (companion.has_perm) rather than a new hardcoded role check,
-- so it is assignable to any support_worker sub-role, not just
-- coordinators. Coordinators keep moderation via the pre-existing
-- permissions_for() short-circuit — no change to that function.
--
-- "Manual release" (flip status regardless of the org flag) is the
-- SAME mechanism as moderation itself: the UPDATE policy/trigger below
-- gate on coordinator-or-moderate_entries, not on the flag, so a
-- coordinator can always hide/release any entry even in an org that
-- has never turned journal_moderation on.
--
-- Every table/function reference is schema-qualified `companion.*` —
-- bare names resolve against the SQL editor's `public` search_path,
-- not `companion` (see CLAUDE.md; bit this repo for real in 062).
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ═══ 1 · COLUMN ═════════════════════════════════════════════════════
alter table companion.log_entries
  add column if not exists status text not null default 'released';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'log_entries_status_check'
      and conrelid = 'companion.log_entries'::regclass
  ) then
    alter table companion.log_entries
      add constraint log_entries_status_check
      check (status in ('pending', 'released', 'hidden'));
  end if;
end $$;

-- Partial: only the (expected to be small) set of entries needing
-- moderator attention is ever queried by status.
create index if not exists log_entries_org_status_idx
  on companion.log_entries (org_id, status) where status <> 'released';

-- ═══ 2 · PERMISSION CATALOGUE ═══════════════════════════════════════
insert into companion.permission_keys
  (key, label, description, kind, target_table, target_cmd, enforced, sort_order) values
  ('moderate_entries', 'Moderate entries',
   'Can release or hide support-worker journal entries awaiting moderation',
   'grant', 'log_entries', 'UPDATE', true, 120)
on conflict (key) do update
  set label = excluded.label, description = excluded.description,
      kind  = excluded.kind,  target_table = excluded.target_table,
      target_cmd = excluded.target_cmd, enforced = excluded.enforced,
      sort_order = excluded.sort_order;

insert into companion.role_permission_defaults
  (base_role, permission_key, default_allowed, max_allowed) values
  ('coordinator','moderate_entries', true,  true),   -- short-circuited in resolution, seeded for completeness
  ('family',     'moderate_entries', false, false),
  ('recipient',  'moderate_entries', false, false),
  ('therapist',  'moderate_entries', false, false),
  ('support_worker','moderate_entries', false, true)  -- grantable, off by default
on conflict (base_role, permission_key) do update
  set default_allowed = excluded.default_allowed,
      max_allowed     = excluded.max_allowed;

-- ═══ 3 · TRIGGERS · server-side status enforcement ═════════════════

-- 3a · INSERT: decide status. Never trusts a client-sent value — every
--      insert path (worker, family, coordinator, recipient) gets its
--      status assigned here, unconditionally.
create or replace function companion.tg_log_entries_assign_status()
returns trigger language plpgsql set search_path = '' as $$
declare v_moderated boolean;
begin
  if public.my_role() = 'support_worker' then
    select coalesce((os.feature_flags ->> 'journal_moderation')::boolean, false)
      into v_moderated
      from companion.org_settings os
      where os.org_id = new.org_id;
    new.status := case when v_moderated then 'pending' else 'released' end;
  else
    new.status := 'released';
  end if;
  return new;
end $$;
drop trigger if exists log_entries_assign_status on companion.log_entries;
create trigger log_entries_assign_status before insert on companion.log_entries
  for each row execute function companion.tg_log_entries_assign_status();

-- 3b · UPDATE: only a coordinator or a moderate_entries holder may
--      change status — closes the gap where "authors and coordinators
--      can update log entries" (067) would otherwise let a worker
--      self-release (or self-hide) their own pending entry via UPDATE.
create or replace function companion.tg_log_entries_status_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status
     and not (public.my_role() = 'coordinator' or companion.has_perm('moderate_entries')) then
    raise exception 'only a coordinator or moderator may change an entry''s status';
  end if;
  return new;
end $$;
drop trigger if exists log_entries_status_guard on companion.log_entries;
create trigger log_entries_status_guard before update on companion.log_entries
  for each row execute function companion.tg_log_entries_status_guard();

-- ═══ 4 · VISIBILITY · can_view_log_entry (gates comments + reactions) ═
-- Adds status = 'released' to the family/recipient branches only. The
-- worker-own branch is deliberately left ungated — a worker must see
-- their own pending/hidden entries (with the status badge). The
-- coordinator branch is also left ungated — coordinators already see
-- every status, moderated or not.
create or replace function public.can_view_log_entry(p_entry_id uuid)
returns boolean
language sql stable security definer
set search_path = 'companion', 'public' as $$
  select exists (
    select 1 from companion.log_entries le
    where le.id = p_entry_id
      and ( (public.my_role() = 'support_worker' and le.author_id = auth.uid())
         or (le.org_id = public.my_org_id() and public.my_role() = 'coordinator')
         or (le.client_id in (select public.client_ids_for_family())   and le.status = 'released')
         or (le.client_id in (select public.client_ids_for_recipient()) and le.status = 'released') )
  )
$$;

-- ═══ 5 · log_entries RLS ════════════════════════════════════════════

-- 5a · family SELECT — add the status gate.
drop policy if exists "family can view log entries" on companion.log_entries;
create policy "family can view log entries"
  on companion.log_entries for select
  using (
    client_id in (select public.client_ids_for_family())
    and status = 'released'
  );

-- 5b · recipient SELECT — add the status gate.
drop policy if exists "recipient can view own journal" on companion.log_entries;
create policy "recipient can view own journal"
  on companion.log_entries for select
  using (
    client_id in (select public.client_ids_for_recipient())
    and status = 'released'
  );

-- 5c · coordinator SELECT — extend to moderate_entries holders,
--      org-wide (no client_workers scope check, by design: a moderator
--      reviews the whole org's pending queue, not just their own
--      assigned clients). Renamed to say what it now does.
drop policy if exists "coordinators can view org log entries" on companion.log_entries;
drop policy if exists "coordinators and moderators can view org log entries" on companion.log_entries;
create policy "coordinators and moderators can view org log entries"
  on companion.log_entries for select
  using (
    org_id = public.my_org_id()
    and (public.my_role() = 'coordinator' or companion.has_perm('moderate_entries'))
  );

-- 5d · UPDATE — extend to moderate_entries holders. The status-change
--      restriction itself lives in the 3b trigger, not here; this only
--      grants row-level UPDATE reach.
drop policy if exists "authors and coordinators can update log entries" on companion.log_entries;
drop policy if exists "authors, coordinators and moderators can update log entries" on companion.log_entries;
create policy "authors, coordinators and moderators can update log entries"
  on companion.log_entries for update
  using (
    author_id = auth.uid()
    or (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (companion.has_perm('moderate_entries') and org_id = public.my_org_id())
  )
  with check (
    author_id = auth.uid()
    or (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (companion.has_perm('moderate_entries') and org_id = public.my_org_id())
  );

-- ═══ 6 · PHOTOS ═════════════════════════════════════════════════════

-- 6a · log_entry_photos SELECT — status-gate the recipient/family
--      branches; add a moderator branch alongside the (unchanged)
--      coordinator and worker branches, since a moderator reviewing
--      the org-wide queue needs to see photos on entries outside their
--      own assigned clients.
drop policy if exists "can view photos for visible entries" on companion.log_entry_photos;
create policy "can view photos for visible entries"
  on companion.log_entry_photos for select
  using (
    exists (
      select 1 from companion.log_entries le
      where le.id = log_entry_photos.entry_id
        and ( (le.client_id in (select public.client_ids_for_recipient()) and le.status = 'released')
           or (le.client_id in (select public.client_ids_for_family())    and le.status = 'released')
           or  le.client_id in (select public.client_ids_for_worker())
           or (le.org_id = public.my_org_id()
               and (public.my_role() = 'coordinator' or companion.has_perm('moderate_entries'))) )
    )
  );

-- 6b · storage.objects — path-based, no entry_id column to join on
--      directly; joins back to log_entries via log_entry_photos'
--      stored photo_path/photo_thumb_path (which are the exact
--      storage object names — see AddEntry.tsx). Split the old
--      combined family+coordinator policy: the coordinator half stays
--      unchanged in reach (now shared with moderators, still no status
--      gate — same breadth as the SELECT policy above); the family
--      half gains a status = 'released' join. Worker's own-upload
--      policy (012) is untouched — it is scoped by uploader user id,
--      not by entry, so it already only ever shows a worker their own
--      uploads regardless of status.
drop policy if exists "family and coordinators can view all journal photos" on storage.objects;
drop policy if exists "coordinators and moderators can view all journal photos" on storage.objects;
create policy "coordinators and moderators can view all journal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-photos'
    and (public.my_role() = 'coordinator' or companion.has_perm('moderate_entries'))
    and (string_to_array(name, '/'))[1] = public.my_org_id()::text
  );

drop policy if exists "family can view released journal photos" on storage.objects;
create policy "family can view released journal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-photos'
    and public.my_role() = 'family'
    and (string_to_array(name, '/'))[1] = public.my_org_id()::text
    and exists (
      select 1 from companion.log_entry_photos lep
      join companion.log_entries le on le.id = lep.entry_id
      where (lep.photo_path = storage.objects.name or lep.photo_thumb_path = storage.objects.name)
        and le.status = 'released'
    )
  );

drop policy if exists "recipient can view own journal photos" on storage.objects;
create policy "recipient can view own journal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-photos'
    and public.my_role() = 'recipient'
    and (string_to_array(name, '/'))[2]::uuid in (select public.client_ids_for_recipient())
    and exists (
      select 1 from companion.log_entry_photos lep
      join companion.log_entries le on le.id = lep.entry_id
      where (lep.photo_path = storage.objects.name or lep.photo_thumb_path = storage.objects.name)
        and le.status = 'released'
    )
  );

commit;

-- ═══ POST-MIGRATION VERIFICATION ════════════════════════════════════

-- V1 · Column + constraint + index exist; every existing row defaulted
--      to 'released' (zero backfill needed — expected count 0 here).
select count(*) as non_released_legacy_rows
from companion.log_entries
where status <> 'released' and created_at < now() - interval '1 minute';

-- V2 · Catalogue rows present for all 5 base roles.
select base_role, default_allowed, max_allowed
from companion.role_permission_defaults
where permission_key = 'moderate_entries'
order by base_role;

-- V3 · Both new triggers attached to companion.log_entries.
select tgname, tgenabled from pg_trigger
where tgrelid = 'companion.log_entries'::regclass
  and tgname in ('log_entries_assign_status', 'log_entries_status_guard');

-- V4 · Every policy this migration touches — read the expressions back
--      and eyeball them against section 5/6 above before trusting this
--      migration in production.
select c.relname, pol.polname, pol.polcmd,
       pg_get_expr(pol.polqual, pol.polrelid)      as using_expr,
       pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
from   pg_policy pol
join   pg_class c on c.oid = pol.polrelid
where  (c.relname, pol.polname) in (
         ('log_entries', 'family can view log entries'),
         ('log_entries', 'recipient can view own journal'),
         ('log_entries', 'coordinators and moderators can view org log entries'),
         ('log_entries', 'authors, coordinators and moderators can update log entries'),
         ('log_entry_photos', 'can view photos for visible entries'),
         ('objects', 'coordinators and moderators can view all journal photos'),
         ('objects', 'family can view released journal photos'),
         ('objects', 'recipient can view own journal photos')
       )
order by c.relname, pol.polname;

-- ── Behavioural — run each as a real signed-in user of that role, with
--    header  Accept-Profile: companion / Content-Profile: companion.

-- V5 · Org has journal_moderation ON. A support_worker inserts a log
--      entry -> status = 'pending'. Same worker, org flag OFF ->
--      status = 'released'.

-- V6 · With the entry from V5 still 'pending': a family member queries
--      log_entries for that client -> the row is absent. The authoring
--      worker queries their own logs -> the row IS present (with
--      status = 'pending' visible to the frontend for the badge).

-- V7 · A plain support_worker granted 'moderate_entries' (via
--      companion.update_sub_role, NOT a coordinator) queries log_entries
--      org-wide -> sees the V5 pending row even for a client they are
--      NOT assigned to via client_workers. Same worker calls
--      update({status:'released'}) on it -> succeeds. A different
--      plain support_worker WITHOUT the permission attempts the same
--      update -> 0 rows affected (RLS silently excludes, not a 403).

-- V8 · The authoring worker attempts update({status:'released'}) on
--      their own still-pending entry -> rejected by the 3b trigger
--      (RLS UPDATE policy's author_id branch would otherwise allow it).

-- V9 · A family member queries storage for the V5 entry's photo (if
--      any) while still 'pending' -> denied. After a moderator
--      releases it -> succeeds via createSignedUrl.
