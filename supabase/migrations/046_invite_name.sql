-- ─────────────────────────────────────────────────────────────
-- 046 · Let an inviter name the person they're inviting
--
-- Pending invites only ever showed the raw email address, and the
-- invite email/text was fully generic. Capturing a name lets the
-- pending-invites list show who's actually being invited, personalises
-- the email, and pre-fills the invitee's own sign-up form (still
-- editable by them, in case it's wrong).
-- ─────────────────────────────────────────────────────────────

alter table invites add column if not exists name text;

create or replace function public.lookup_invite(p_token text)
returns table (
  org_id     uuid,
  org_name   text,
  email      text,
  name       text,
  role       text,
  expires_at timestamptz,
  status     text
)
language sql
security definer
set search_path = public
as $$
  select i.org_id, o.name as org_name, i.email, i.name, i.role, i.expires_at, i.status
  from   invites i
  join   organisations o on o.id = i.org_id
  where  i.token = p_token
  limit  1;
$$;
