-- ─────────────────────────────────────────────────────────────
-- 057 · Notices coordinator-only + tighten message privacy
--
-- Part 1 — notices. The `notices` table has been in live use for a while
-- but was created out-of-band (dashboard/SQL editor) and never captured as
-- a migration — there is no tracked RLS on it at all. The frontend's
-- "Post a notice" form was shown to every role with no gate, so this both
-- backfills the table definition (idempotent, matches the shape already
-- used by src/types/database.ts) and adds real RLS: any org member can
-- read notices, but only a coordinator can create one. Delete stays
-- author-or-coordinator, matching the app's existing assumption.
--
-- Part 2 — messages. The SELECT policy (044) granted org-wide 1:1 message
-- visibility to coordinator/family roles in family-type orgs, and to a
-- coordinator across any worker-involving thread in provider-type orgs —
-- regardless of whether that person was actually a party to the thread.
-- The app's own queries already filter down to "sender, recipient, or the
-- group thread" client-side, but the database itself allowed more, which
-- means anything calling Supabase directly (bypassing the app's own
-- .or()/.is() filters) could read other people's private messages. Tightens
-- the policy to exactly that: a message is visible only to its sender, its
-- recipient, or (for the shared group thread, recipient_id null) org
-- coordinators/family — never to an uninvolved third party.
-- ─────────────────────────────────────────────────────────────

-- ── notices ──────────────────────────────────────────────────

create table if not exists notices (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organisations(id) on delete cascade,
  client_id  uuid not null references clients(id)       on delete cascade,
  author_id  uuid references profiles(id)                on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);

alter table notices enable row level security;

drop policy if exists "org members can view notices"    on notices;
drop policy if exists "coordinators can post notices"    on notices;
drop policy if exists "author or coordinator can delete notices" on notices;

create policy "org members can view notices"
  on notices for select
  using (org_id = public.my_org_id());

create policy "coordinators can post notices"
  on notices for insert
  with check (
    org_id = public.my_org_id()
    and public.my_role() = 'coordinator'
    and author_id = auth.uid()
  );

create policy "author or coordinator can delete notices"
  on notices for delete
  using (
    org_id = public.my_org_id()
    and (author_id = auth.uid() or public.my_role() = 'coordinator')
  );

-- ── messages ─────────────────────────────────────────────────

drop policy if exists "org members can view messages" on messages;

create policy "org members can view messages"
  on messages for select
  using (
    org_id = public.my_org_id()
    and (
      sender_id = auth.uid()
      or recipient_id = auth.uid()
      or (recipient_id is null and public.my_role() in ('coordinator', 'family'))
    )
  );
