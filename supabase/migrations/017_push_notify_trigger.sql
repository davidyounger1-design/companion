-- Trigger: call push-notify edge function whenever a message is inserted
create or replace function notify_push_on_message()
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
    body    := jsonb_build_object('record', row_to_json(NEW))::text
  );
  return NEW;
end;
$$;

drop trigger if exists push_on_message on messages;
create trigger push_on_message
  after insert on messages
  for each row execute function notify_push_on_message();
