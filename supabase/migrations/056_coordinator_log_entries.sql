-- ─────────────────────────────────────────────────────────────
-- 056 · Coordinators can log activity for participants in their org
--
-- log_entries only ever granted INSERT to family members and workers
-- assigned via client_workers — a coordinator, despite being able to
-- view and delete entries in their org, had no way to add one. A
-- coordinator is effectively also a worker for any participant they
-- oversee, so this closes that gap the same way 011's family-insert
-- policy does, scoped by org instead of client_family.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "coordinators can log for org clients" on log_entries;

create policy "coordinators can log for org clients"
  on log_entries for insert
  with check (
    public.my_role() = 'coordinator'
    and author_id = auth.uid()
    and client_id in (select public.client_ids_for_org())
  );
