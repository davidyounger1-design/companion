-- Public demo request submissions from the landing page
create table if not exists public.demo_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  email      text not null,
  org_name   text,
  message    text,
  created_at timestamptz default now()
);

-- Allow anonymous inserts (landing page has no auth)
alter table public.demo_requests enable row level security;

create policy "anyone can submit a demo request"
  on public.demo_requests for insert
  with check (true);

-- Only service-role (admin) can read submissions
create policy "service role reads demo requests"
  on public.demo_requests for select
  using (false);  -- anon/authenticated cannot read; use service key in admin tooling
