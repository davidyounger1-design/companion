-- Allow coordinators to delete any entry in their org,
-- and family members to delete their own entries (60-second window enforced in UI).

drop policy if exists "coordinators can delete log entries"  on log_entries;
drop policy if exists "family can delete own log entries"    on log_entries;

create policy "coordinators can delete log entries"
  on log_entries for delete
  using (
    public.my_role() = 'coordinator'
    and org_id = public.my_org_id()
  );

create policy "family can delete own log entries"
  on log_entries for delete
  using (
    author_id = auth.uid()
    and org_id = public.my_org_id()
  );
