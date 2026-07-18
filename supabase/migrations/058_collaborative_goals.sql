-- ─────────────────────────────────────────────────────────────
-- 058 · Collaborative participant goals (idempotent)
-- Previously only coordinators could create/edit goals — everyone else
-- (including the recipient themselves) could either only view them or, for
-- ordinary family members and the recipient, not access them at all. Goals
-- are now a shared, person-centred record: anyone connected to the
-- participant (coordinator, family, the recipient, an assigned worker) can
-- add one, but only the author can edit/discontinue their own — except
-- family and coordinators, who can act on any goal for participants they
-- have access to. Mirrors the same extension onto goal_progress_records so
-- family/recipient can see (and log) progress on goals they can now see.
-- ─────────────────────────────────────────────────────────────

alter table participant_goals add column if not exists category text
  check (category in (
    'daily_living','health_wellbeing','social_community',
    'relationships','home','employment','education','choice_control'
  ));

-- ── participant_goals ───────────────────────────────────────────
drop policy if exists "coordinators can manage goals" on participant_goals;
drop policy if exists "workers can view goals"        on participant_goals;
drop policy if exists "decision_maker can view goals" on participant_goals;
drop policy if exists "connected users can view goals" on participant_goals;
drop policy if exists "connected users can add goals"  on participant_goals;
drop policy if exists "coordinators can edit any goal" on participant_goals;
drop policy if exists "coordinators can delete any goal" on participant_goals;
drop policy if exists "family can edit any goal for their participant" on participant_goals;
drop policy if exists "family can delete any goal for their participant" on participant_goals;
drop policy if exists "recipient can edit their own goals" on participant_goals;
drop policy if exists "recipient can delete their own goals" on participant_goals;
drop policy if exists "workers can edit their own goals" on participant_goals;
drop policy if exists "workers can delete their own goals" on participant_goals;

create policy "connected users can view goals"
  on participant_goals for select
  using (
    (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or client_id in (select client_id from client_family  where family_id = auth.uid() and status = 'active')
    or client_id in (select id from clients where recipient_profile_id = auth.uid())
    or client_id in (select client_id from client_workers where worker_id = auth.uid())
    or client_id in (select id from clients where decision_maker_id = auth.uid())
  );

create policy "connected users can add goals"
  on participant_goals for insert
  with check (
    created_by = auth.uid()
    and (
      (org_id = public.my_org_id() and public.my_role() = 'coordinator')
      or client_id in (select client_id from client_family  where family_id = auth.uid() and status = 'active')
      or client_id in (select id from clients where recipient_profile_id = auth.uid())
      or client_id in (select client_id from client_workers where worker_id = auth.uid())
    )
  );

create policy "coordinators can edit any goal"
  on participant_goals for update
  using (org_id = public.my_org_id() and public.my_role() = 'coordinator');

create policy "coordinators can delete any goal"
  on participant_goals for delete
  using (org_id = public.my_org_id() and public.my_role() = 'coordinator');

create policy "family can edit any goal for their participant"
  on participant_goals for update
  using (client_id in (select client_id from client_family where family_id = auth.uid() and status = 'active'));

create policy "family can delete any goal for their participant"
  on participant_goals for delete
  using (client_id in (select client_id from client_family where family_id = auth.uid() and status = 'active'));

create policy "recipient can edit their own goals"
  on participant_goals for update
  using (
    created_by = auth.uid()
    and client_id in (select id from clients where recipient_profile_id = auth.uid())
  );

create policy "recipient can delete their own goals"
  on participant_goals for delete
  using (
    created_by = auth.uid()
    and client_id in (select id from clients where recipient_profile_id = auth.uid())
  );

create policy "workers can edit their own goals"
  on participant_goals for update
  using (
    created_by = auth.uid()
    and client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

create policy "workers can delete their own goals"
  on participant_goals for delete
  using (
    created_by = auth.uid()
    and client_id in (select client_id from client_workers where worker_id = auth.uid())
  );

-- ── goal_progress_records ───────────────────────────────────────
-- Previously only workers/coordinators/decision-maker could see or log
-- progress — ordinary family members and the recipient had no access at
-- all, which would have left the goal visible but its progress history
-- silently empty for them. Extend to match the new goal viewers.
drop policy if exists "workers can log progress"         on goal_progress_records;
drop policy if exists "workers can view progress"        on goal_progress_records;
drop policy if exists "coordinators can manage progress" on goal_progress_records;
drop policy if exists "decision_maker can view progress" on goal_progress_records;
drop policy if exists "connected users can view progress" on goal_progress_records;
drop policy if exists "connected users can log progress"  on goal_progress_records;

create policy "connected users can view progress"
  on goal_progress_records for select
  using (
    (org_id = public.my_org_id() and public.my_role() = 'coordinator')
    or client_id in (select client_id from client_family  where family_id = auth.uid() and status = 'active')
    or client_id in (select id from clients where recipient_profile_id = auth.uid())
    or client_id in (select client_id from client_workers where worker_id = auth.uid())
    or client_id in (select id from clients where decision_maker_id = auth.uid())
  );

create policy "connected users can log progress"
  on goal_progress_records for insert
  with check (
    author_id = auth.uid()
    and (
      (org_id = public.my_org_id() and public.my_role() = 'coordinator')
      or client_id in (select client_id from client_family  where family_id = auth.uid() and status = 'active')
      or client_id in (select id from clients where recipient_profile_id = auth.uid())
      or client_id in (select client_id from client_workers where worker_id = auth.uid())
    )
  );

create policy "coordinators can manage progress"
  on goal_progress_records for all
  using (org_id = public.my_org_id() and public.my_role() = 'coordinator');
