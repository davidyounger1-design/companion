-- ─────────────────────────────────────────────────────────────
-- 039 · client_feedback is a care-team-only note, not visible
-- to the recipient it's about
--
-- client_feedback started (026) as recipient-authored self-notes,
-- then (028) opened up to the whole circle writing about the
-- recipient. That flip means a recipient viewing "their own"
-- feedback stream would now be reading private notes the care team
-- wrote about them — not the intent. Recipients no longer read or
-- write client_feedback at all; client_ids_for_recipient() stays
-- for other uses (clients table, moods, etc).
-- ─────────────────────────────────────────────────────────────

drop policy if exists "recipient can view own feedback" on client_feedback;
drop policy if exists "recipient can add own feedback"  on client_feedback;

create or replace function public.can_view_client_feedback(p_feedback_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from client_feedback cf
    where cf.id = p_feedback_id
      and (
        (cf.org_id = public.my_org_id() and public.my_role() = 'coordinator')
        or cf.client_id in (select public.client_ids_for_family())
        or cf.client_id in (select public.client_ids_for_worker())
        or cf.client_id in (select public.client_ids_for_therapist())
      )
  )
$$;
