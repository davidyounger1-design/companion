-- ─────────────────────────────────────────────────────────────
-- 044 · Message visibility: org-type-aware coordinator scope
--
-- 043 gave coordinator (and family) blanket org-wide visibility.
-- That's right for a family-plan org (one client, one family — a
-- coordinator there usually *is* a family member), but wrong for a
-- provider org managing several unrelated clients: a coordinator
-- there shouldn't be able to read a private family <-> therapist
-- chat, or one family's private conversation, just because they
-- manage the org. Refined rule:
--
--   - Everyone always sees their own threads (sender or recipient).
--   - The shared "group" thread (recipient_id is null) stays visible
--     to coordinator + family regardless of org type — it's their
--     named shared channel, not a private 1:1.
--   - Family-plan orgs: coordinator and family also see every other
--     1:1 thread in the org.
--   - Provider orgs: coordinator additionally sees only "worker-based"
--     1:1 threads — ones with a coordinator or worker on either side.
--     A family member's 1:1 with another family member, a therapist,
--     or a recipient stays private unless a coordinator/worker is a
--     direct party to it.
--   - Workers and therapists are unaffected — still own threads only.
-- ─────────────────────────────────────────────────────────────

create or replace function public.my_org_type()
returns text
language sql stable security definer set search_path = public
as $$
  select o.org_type
  from public.organisations o
  join public.profiles p on p.org_id = o.id
  where p.id = auth.uid()
  limit 1
$$;

drop policy if exists "org members can view messages" on messages;

create policy "org members can view messages"
  on messages for select
  using (
    org_id = public.my_org_id()
    and (
      sender_id = auth.uid() or recipient_id = auth.uid()
      or (recipient_id is null and public.my_role() in ('coordinator', 'family'))
      or (public.my_org_type() = 'family' and public.my_role() in ('coordinator', 'family'))
      or (
        public.my_org_type() <> 'family'
        and public.my_role() = 'coordinator'
        and recipient_id is not null
        and exists (
          select 1 from public.profiles pr
          where pr.id in (sender_id, recipient_id)
            and pr.role in ('coordinator', 'support_worker', 'trusted_support_worker')
        )
      )
    )
  );
