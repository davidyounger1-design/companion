-- ─────────────────────────────────────────────────────────────
-- 030 · Recipient can view and log their own journal entries
--
-- Extends the recipient role (026) beyond the feedback page: they
-- can now see and add entries in their own care journal, same as
-- a family member can. Also extends log_entry_comments visibility
-- (027) so recipients can comment on their own journal entries.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "recipient can view own journal" on log_entries;
drop policy if exists "recipient can log for themself" on log_entries;

create policy "recipient can view own journal"
  on log_entries for select
  using (client_id in (select public.client_ids_for_recipient()));

create policy "recipient can log for themself"
  on log_entries for insert
  with check (
    public.my_role() = 'recipient'
    and author_id = auth.uid()
    and org_id = public.my_org_id()
    and client_id in (select public.client_ids_for_recipient())
  );

create or replace function public.can_view_log_entry(p_entry_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from log_entries le
    where le.id = p_entry_id
      and (
        (public.my_role() in ('support_worker', 'trusted_support_worker') and le.author_id = auth.uid())
        or (le.org_id = public.my_org_id() and public.my_role() = 'coordinator')
        or (le.client_id in (select public.client_ids_for_family()))
        or (le.client_id in (select public.client_ids_for_recipient()))
      )
  )
$$;
