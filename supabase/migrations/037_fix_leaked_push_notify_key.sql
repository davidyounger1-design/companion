-- ─────────────────────────────────────────────────────────────
-- 037 · Stop hardcoding the service_role key in push notify trigger
--
-- 017_push_notify_trigger.sql committed a live service_role key
-- directly into the migration file — full database admin access,
-- sitting in plain text in git. This redefines the trigger function
-- to read the key from Supabase Vault instead (same 'service_role_key'
-- secret already used by 034's pg_cron job), so rotating the key in
-- one place (Vault) updates every consumer automatically.
--
-- REQUIRED before/with this migration:
-- 1. Rotate the service_role key in Supabase (Settings → API →
--    Secret keys → roll the secret). This invalidates the old,
--    leaked key immediately.
-- 2. Update the Vault secret with the new key:
--      delete from vault.secrets where name = 'service_role_key';
--      select vault.create_secret('<new-service-role-key>', 'service_role_key');
-- 3. Run this file.
-- ─────────────────────────────────────────────────────────────

create or replace function notify_push_on_message()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _url text := 'https://oprsmhyvihrahxpfvdih.supabase.co/functions/v1/push-notify';
  _key text;
begin
  select decrypted_secret into _key from vault.decrypted_secrets where name = 'service_role_key';

  perform net.http_post(
    url     := _url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || _key
               ),
    body    := jsonb_build_object('record', row_to_json(NEW))::text
  );
  return NEW;
end;
$$;
