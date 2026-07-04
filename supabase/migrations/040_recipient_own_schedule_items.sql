-- ─────────────────────────────────────────────────────────────
-- 040 · Recipients can add and manage their own schedule items
--
-- Recipients could view their schedule (033) but only family/the
-- coordinator could add to it. Recipients can now add their own
-- appointments/activities, and edit or remove only the ones they
-- created themselves — not items their family or coordinator added.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "recipient can create own schedule items" on schedule_items;
drop policy if exists "recipient can update own schedule items" on schedule_items;
drop policy if exists "recipient can delete own schedule items" on schedule_items;

create policy "recipient can create own schedule items"
  on schedule_items for insert
  with check (
    created_by = auth.uid()
    and public.my_role() = 'recipient'
    and client_id in (select public.client_ids_for_recipient())
  );

create policy "recipient can update own schedule items"
  on schedule_items for update
  using (
    created_by = auth.uid()
    and public.my_role() = 'recipient'
    and client_id in (select public.client_ids_for_recipient())
  );

create policy "recipient can delete own schedule items"
  on schedule_items for delete
  using (
    created_by = auth.uid()
    and public.my_role() = 'recipient'
    and client_id in (select public.client_ids_for_recipient())
  );
