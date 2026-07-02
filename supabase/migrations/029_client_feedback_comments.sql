-- ─────────────────────────────────────────────────────────────
-- 029 · Comments on client_feedback   (idempotent)
--
-- Same principle as log_entry_comments (027): anyone who can see a
-- feedback item can comment on it. can_view_client_feedback() mirrors
-- the client_feedback SELECT policies from 026/028 in one place.
-- ─────────────────────────────────────────────────────────────

create table if not exists client_feedback_comments (
  id          uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references client_feedback(id) on delete cascade,
  client_id   uuid not null references clients(id) on delete cascade,
  org_id      uuid not null references organisations(id) on delete cascade,
  author_id   uuid not null references profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists client_feedback_comments_feedback_created
  on client_feedback_comments (feedback_id, created_at);

create or replace function public.can_view_client_feedback(p_feedback_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from client_feedback cf
    where cf.id = p_feedback_id
      and (
        cf.client_id in (select public.client_ids_for_recipient())
        or (cf.org_id = public.my_org_id() and public.my_role() = 'coordinator')
        or cf.client_id in (select public.client_ids_for_family())
        or cf.client_id in (select public.client_ids_for_worker())
        or cf.client_id in (select public.client_ids_for_therapist())
      )
  )
$$;

grant execute on function public.can_view_client_feedback(uuid) to authenticated;

alter table client_feedback_comments enable row level security;

drop policy if exists "can view comments on visible feedback" on client_feedback_comments;
drop policy if exists "can comment on visible feedback"       on client_feedback_comments;

create policy "can view comments on visible feedback"
  on client_feedback_comments for select
  using (public.can_view_client_feedback(feedback_id));

create policy "can comment on visible feedback"
  on client_feedback_comments for insert
  with check (
    author_id = auth.uid()
    and public.can_view_client_feedback(feedback_id)
  );
