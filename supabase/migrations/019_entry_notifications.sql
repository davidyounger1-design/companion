-- Family members can opt in to push notifications when a new journal entry is logged.
-- Adds notify_on_entry flag to push_subscriptions and a trigger on log_entries.

alter table push_subscriptions
  add column if not exists notify_on_entry boolean not null default false;

-- Service role can update the flag (used via the client-side hook)
drop policy if exists "users manage own push subscriptions" on push_subscriptions;
create policy "users manage own push subscriptions"
  on push_subscriptions for all
  using (user_id = auth.uid());

-- Trigger: fire push-notify edge function when a journal entry is inserted
create or replace function notify_push_on_entry()
returns trigger language plpgsql security definer as $$
declare
  _url text := 'https://oprsmhyvihrahxpfvdih.supabase.co/functions/v1/push-notify';
  _key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wcnNtaHl2aWhyYWh4cGZ2ZGloIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE4NTc4NiwiZXhwIjoyMDk3NzYxNzg2fQ.KrgHl-Zjyr1ZxgDPICBv4TddcpF3adLGXzwl4w4Gk0s';
begin
  perform net.http_post(
    url     := _url,
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || _key
               ),
    body    := jsonb_build_object(
                 'record', row_to_json(NEW),
                 'type',   'entry'
               )::text
  );
  return NEW;
end;
$$;

drop trigger if exists push_on_entry on log_entries;
create trigger push_on_entry
  after insert on log_entries
  for each row execute function notify_push_on_entry();
