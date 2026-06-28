-- ─────────────────────────────────────────────────────────────
-- 022 · check_pending_invite — public RPC for sign-in step 3
--
-- Returns {found: true} when a non-expired pending invite exists
-- for the given email. Does NOT expose the invite token — the
-- caller is told to check their email for the invite link.
-- ─────────────────────────────────────────────────────────────

create or replace function public.check_pending_invite(p_email text)
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'found', exists(
      select 1 from invites
      where lower(email) = lower(p_email)
        and status = 'pending'
        and expires_at > now()
    )
  )
$$;
