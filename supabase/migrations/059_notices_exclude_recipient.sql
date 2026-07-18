-- ─────────────────────────────────────────────────────────────
-- 059 · Notices are not for the recipient (idempotent)
-- Notices are posted by the care team (coordinator) to communicate about
-- the participant to the rest of the circle — not something the recipient
-- themselves is meant to see. 057's SELECT policy granted any org member
-- (including a recipient login) read access; the app's own UI already hides
-- Notices from the recipient view, but the database itself allowed more.
-- Tighten SELECT to exclude the recipient role.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "org members can view notices" on notices;

create policy "org members can view notices"
  on notices for select
  using (
    org_id = public.my_org_id()
    and public.my_role() <> 'recipient'
  );
