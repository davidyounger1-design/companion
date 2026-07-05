-- ─────────────────────────────────────────────────────────────
-- 043 · Message visibility: workers/therapists see only their own
-- threads; coordinator and family keep full org-wide visibility
--
-- The RLS from migration 013 gave every coordinator, support_worker,
-- and trusted_support_worker full org-wide SELECT on messages —
-- meaning any worker could read every other worker's and every
-- family member's private 1:1 threads directly via the API, not just
-- through the app's own (correctly scoped) UI queries. The app's
-- messaging model is genuinely 1:1 (MessageThread.tsx keys threads by
-- sender/recipient pair) plus one shared "group" thread for family +
-- coordinator, so RLS should match that: workers and therapists can
-- only see rows where they're the sender or recipient; coordinator
-- and family keep seeing everything in their org, group thread
-- included.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "org members can view messages" on messages;

create policy "org members can view messages"
  on messages for select
  using (
    (org_id = public.my_org_id() and public.my_role() in ('coordinator', 'family'))
    or (org_id = public.my_org_id() and (sender_id = auth.uid() or recipient_id = auth.uid()))
  );
