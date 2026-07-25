-- ─────────────────────────────────────────────────────────────
-- 067 · Coordinators can edit/delete any log entry (idempotent)
--
-- Migration 032 restricted UPDATE to the entry author only.
-- Coordinators need to moderate any entry in their org — fix
-- labels, types, mood scores, and delete entries they didn't
-- write. Drops and recreates the update and delete policies to
-- also allow coordinators for their org.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "authors can update own log entries"     on companion.log_entries;
drop policy if exists "authors can delete own entries"          on companion.log_entries;

create policy "authors and coordinators can update log entries"
  on companion.log_entries for update
  using (
    author_id = auth.uid()
    or (public.my_role() = 'coordinator' and org_id = public.my_org_id())
  )
  with check (
    author_id = auth.uid()
    or (public.my_role() = 'coordinator' and org_id = public.my_org_id())
  );

create policy "authors and coordinators can delete log entries"
  on companion.log_entries for delete
  using (
    author_id = auth.uid()
    or (public.my_role() = 'coordinator' and org_id = public.my_org_id())
  );
