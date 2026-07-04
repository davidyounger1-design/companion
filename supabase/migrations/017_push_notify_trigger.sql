-- Trigger: call push-notify edge function whenever a message is inserted
--
-- SECURITY: this originally hardcoded a live service_role key here —
-- see 037_fix_leaked_push_notify_key.sql, which rotates the key and
-- redefines this function to read it from Supabase Vault instead.
-- Left as historical record; the function body below is superseded.
create or replace function notify_push_on_message()
returns trigger language plpgsql security definer as $$
declare
  _url text := 'https://oprsmhyvihrahxpfvdih.supabase.co/functions/v1/push-notify';
  _key text := 'REDACTED — see 037_fix_leaked_push_notify_key.sql';
begin
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

drop trigger if exists push_on_message on messages;
create trigger push_on_message
  after insert on messages
  for each row execute function notify_push_on_message();
