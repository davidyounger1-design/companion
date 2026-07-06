-- ─────────────────────────────────────────────────────────────
-- 048 · Finish the service_role key rotation + lock push_subscriptions
--
-- (a) 037 moved notify_push_on_message() off the hardcoded key onto the
--     Vault secret, but notify_push_on_entry() (019/020) still has the
--     leaked key literal. This redefines it to read from Vault too, so
--     after you rotate the key + update the Vault secret, BOTH triggers
--     use the new key and the literal is dead everywhere.
--
-- (b) 016 created a `push_subscriptions` "service read" policy with
--     `using (true)` — every authenticated user could read every device's
--     push encryption secrets (p256dh/auth) org-wide and forge push
--     messages. Drop it; the edge functions use the service role, which
--     bypasses RLS, so no permissive read policy is needed.
--
-- PREREQUISITE for (a): rotate the key and update the Vault secret first
-- (see the rotation runbook / migration 037 steps). Running this before
-- the Vault secret exists would leave the entry trigger unable to find a
-- key — but 037's message trigger already depends on that same secret, so
-- if messaging push works, the secret is present.
-- ─────────────────────────────────────────────────────────────

create or replace function notify_push_on_entry()
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
    body    := jsonb_build_object('record', row_to_json(NEW), 'type', 'entry')
  );
  return NEW;
end;
$$;

-- Lock down push_subscriptions reads. The owner policy from 016 ("own subs")
-- remains so a user can still manage their own; only the world-read is removed.
drop policy if exists "service read" on public.push_subscriptions;
