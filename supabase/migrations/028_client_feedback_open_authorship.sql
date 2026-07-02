-- ─────────────────────────────────────────────────────────────
-- 028 · client_feedback: whole care team can write, not just recipient
--
-- Originally only the recipient could author feedback about themself.
-- Now anyone who can already see a client's feedback (coordinator,
-- family, assigned workers, circle therapists) can also write it —
-- the recipient's feedback stream shows what their whole care team
-- has to say, plus anything they add themselves.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "coordinators can add feedback for org clients"      on client_feedback;
drop policy if exists "family can add feedback for their clients"          on client_feedback;
drop policy if exists "workers can add feedback for assigned clients"      on client_feedback;
drop policy if exists "therapists can add feedback for circle clients"     on client_feedback;

create policy "coordinators can add feedback for org clients"
  on client_feedback for insert
  with check (
    author_id = auth.uid()
    and org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
  );

create policy "family can add feedback for their clients"
  on client_feedback for insert
  with check (
    author_id = auth.uid()
    and public.my_role() = 'family'
    and client_id in (select public.client_ids_for_family())
  );

create policy "workers can add feedback for assigned clients"
  on client_feedback for insert
  with check (
    author_id = auth.uid()
    and public.my_role() in ('support_worker', 'trusted_support_worker')
    and client_id in (select public.client_ids_for_worker())
  );

create policy "therapists can add feedback for circle clients"
  on client_feedback for insert
  with check (
    author_id = auth.uid()
    and public.my_role() = 'therapist'
    and client_id in (select public.client_ids_for_therapist())
  );
