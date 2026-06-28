-- net.http_post takes body as jsonb, not text.
-- Both trigger functions were casting ::text which caused "function does not exist" errors,
-- silently rolling back every message and log-entry insert.

create or replace function notify_push_on_message()
returns trigger language plpgsql security definer as $$
declare
  _url text := 'https://oprsmhyvihrahxpfvdih.supabase.co/functions/v1/push-notify';
  _key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wcnNtaHl2aWhyYWh4cGZ2ZGloIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE4NTc4NiwiZXhwIjoyMDk3NzYxNzg2fQ.KrgHl-Zjyr1ZxgDPICBv4TddcpF3adLGXzwl4w4Gk0s';
begin
  perform net.http_post(
    url     := _url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || _key),
    body    := jsonb_build_object('record', row_to_json(NEW))
  );
  return NEW;
end;
$$;

create or replace function notify_push_on_entry()
returns trigger language plpgsql security definer as $$
declare
  _url text := 'https://oprsmhyvihrahxpfvdih.supabase.co/functions/v1/push-notify';
  _key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wcnNtaHl2aWhyYWh4cGZ2ZGloIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MjE4NTc4NiwiZXhwIjoyMDk3NzYxNzg2fQ.KrgHl-Zjyr1ZxgDPICBv4TddcpF3adLGXzwl4w4Gk0s';
begin
  perform net.http_post(
    url     := _url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || _key),
    body    := jsonb_build_object('record', row_to_json(NEW), 'type', 'entry')
  );
  return NEW;
end;
$$;
