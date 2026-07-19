-- ─────────────────────────────────────────────────────────────
-- 062 · Notices: family can post/edit on family-plan orgs; add editing
--
-- 057 made notices coordinator-only to post. On a family-plan org (a single
-- participant, typically run day-to-day by family rather than a formal
-- coordinator role) that's too restrictive — family members should be able
-- to post notices too. Provider-type orgs (multiple participants, a real
-- coordinator role) keep the coordinator-only posting rule unchanged.
--
-- Also adds an UPDATE policy — notices previously had no way to edit one
-- at all, only create + delete. Mirrors the existing delete rule: the
-- author can edit their own notice, or a coordinator can edit any.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "coordinators can post notices" on notices;
drop policy if exists "connected users can post notices" on notices;

create policy "connected users can post notices"
  on notices for insert
  with check (
    org_id = public.my_org_id()
    and author_id = auth.uid()
    and (
      public.my_role() = 'coordinator'
      or (public.my_role() = 'family' and public.my_org_type() = 'family')
    )
  );

drop policy if exists "author or coordinator can edit notices" on notices;

create policy "author or coordinator can edit notices"
  on notices for update
  using (
    org_id = public.my_org_id()
    and (author_id = auth.uid() or public.my_role() = 'coordinator')
  );
