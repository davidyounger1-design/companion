-- Per-org AES-256-GCM keys for client-side photo encryption.
-- Photos are encrypted in the browser before upload; this table holds the key.
-- Even Supabase storage browsing shows unreadable ciphertext.

create table if not exists org_photo_keys (
  org_id     uuid primary key references organisations(id) on delete cascade,
  key_hex    text not null check (length(key_hex) = 64),  -- 32 bytes as hex
  created_at timestamptz not null default now()
);

alter table org_photo_keys enable row level security;

-- Any authenticated org member can read their org's key (needed to view photos)
create policy "org members read their photo key"
  on org_photo_keys for select
  using (org_id = public.my_org_id());

-- Back-fill keys for all existing orgs
insert into org_photo_keys (org_id, key_hex)
select id, replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')
from organisations
where id not in (select org_id from org_photo_keys)
on conflict do nothing;

-- Auto-create a key whenever a new org is created
create or replace function _create_org_photo_key()
returns trigger language plpgsql security definer as $$
begin
  insert into org_photo_keys (org_id, key_hex)
  values (new.id, replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''))
  on conflict (org_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_org_photo_key on organisations;
create trigger trg_org_photo_key
  after insert on organisations
  for each row execute function _create_org_photo_key();

-- RPC: authenticated org member fetches their key (lazy-creates if somehow missing)
create or replace function get_or_create_photo_key()
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid := my_org_id();
  v_key text;
begin
  if v_org is null or auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  select key_hex into v_key from org_photo_keys where org_id = v_org;

  if v_key is null then
    v_key := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
    insert into org_photo_keys (org_id, key_hex) values (v_org, v_key)
    on conflict (org_id) do nothing;
    -- Re-read in case of concurrent insert
    select key_hex into v_key from org_photo_keys where org_id = v_org;
  end if;

  return v_key;
end;
$$;
