-- Plans table — single source of truth for pricing shown in the app,
-- marketing pages, and investor overview.
create table if not exists public.plans (
  id            text primary key,           -- 'family' | 'solo' | 'starter' | 'team' | 'enterprise'
  name          text        not null,
  tier_label    text        not null,        -- display label for the tier chip
  price_display text        not null,        -- e.g. 'A$29' or 'Free' or 'Custom'
  price_suffix  text        not null default '', -- e.g. '/mo flat' or '/client/mo' or ''
  sub_text      text        not null,        -- short descriptor line
  description   text        not null default '',
  features      text[]      not null default '{}',
  is_featured   boolean     not null default false,
  is_active     boolean     not null default true,
  sort_order    int         not null default 0,
  created_at    timestamptz not null default now()
);

-- Publicly readable — anyone can see plan data (used by static pages).
alter table public.plans enable row level security;
create policy "plans are public" on public.plans
  for select using (true);

-- Seed current plans
insert into public.plans (id, name, tier_label, price_display, price_suffix, sub_text, description, features, is_featured, sort_order) values
  ('family',     'Family',     'FAMILY',     'Free',  '',             'For families & guardians, forever',
   'Forever. The digest, messaging, conversation starters and sharing controls.',
   array['Daily digest & timeline', 'Conversation starters', 'Messaging with the team', 'Control who sees what'],
   false, 1),

  ('solo',       'Solo',       'SOLO',       'A$29',  '/mo flat',     'billed monthly · up to 3 clients',
   '1–3 clients. Logging, family digests, messaging.',
   array['3 active participants', 'Unlimited workers', 'Family digest', 'Behaviour notes', 'NDIS-ready records'],
   false, 2),

  ('starter',    'Starter',    'STARTER',    'A$49',  '/mo flat',     'billed monthly · up to 10 clients',
   'Up to 10 clients. Staff roster, team invites, NDIS-claimable.',
   array['10 active participants', 'Unlimited workers', 'Everything in Solo', 'Shared therapy circles', 'Priority support'],
   false, 3),

  ('team',       'Team',       'TEAM',       'A$7',   '/client/mo',   'billed monthly · unlimited staff · 8+ clients',
   '8+ clients. Incident workflows, NDIS exports, priority support.',
   array['Unlimited participants', 'Everything in Starter', 'Incident workflows & flags', 'NDIS-ready exports', 'Priority support'],
   true, 4),

  ('enterprise', 'Enterprise', 'ENTERPRISE', 'Custom', '',            'Multi-site & large providers',
   'Multi-site, SSO, compliance, dedicated success & API.',
   array['Unlimited participants', 'Everything in Team', 'SSO & advanced compliance', 'Dedicated success manager', 'API & integrations'],
   false, 5)

on conflict (id) do update set
  name          = excluded.name,
  tier_label    = excluded.tier_label,
  price_display = excluded.price_display,
  price_suffix  = excluded.price_suffix,
  sub_text      = excluded.sub_text,
  description   = excluded.description,
  features      = excluded.features,
  is_featured   = excluded.is_featured,
  sort_order    = excluded.sort_order;
