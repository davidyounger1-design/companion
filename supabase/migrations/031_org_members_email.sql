-- ─────────────────────────────────────────────────────────────
-- 031 · get_org_members: include email
--
-- The Members page UI already renders m.email when present, but
-- the RPC only ever selected id/full_name/role from profiles —
-- email lives in auth.users, not profiles, so it was always
-- undefined and silently never shown.
-- ─────────────────────────────────────────────────────────────

drop function if exists public.get_org_members();

create or replace function public.get_org_members()
returns table (
  id        uuid,
  full_name text,
  role      text,
  email     text
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.role, u.email
  from   profiles p
  join   auth.users u on u.id = p.id
  where  p.org_id = public.my_org_id()
  order  by p.role, p.full_name;
$$;

grant execute on function public.get_org_members() to authenticated;
