-- 095_rostering_notify.sql — push-notify trigger for shift publish/cancel
--
-- Design: docs/superpowers/specs/2026-08-24-rostering-design.md §6.2. Publish
-- and cancel fire an AFTER UPDATE trigger POSTing {record, type: 'shift'} to
-- the push-notify edge function (which gains a matching `shift` branch —
-- shipped alongside this migration, not part of it; edge functions deploy via
-- the Dashboard, not a migration). The WHEN clause means note-edits on a
-- published shift never re-notify. URL/auth pattern matches 034/085 exactly
-- (hardcoded project URL, service_role_key from Vault) — no app.settings
-- config layer exists anywhere else in this repo, so none is invented here.
--
-- ⚠ UNVERIFIED COMBINATION, flagged for David to check on first real publish:
-- 034 and 085 both call net.http_post + read vault.decrypted_secrets from
-- pg_cron's own scheduled-job context. This is the first place in the repo
-- doing the same from a normal AFTER UPDATE trigger fired inside a user's own
-- RPC transaction (rostering_publish_shift/rostering_cancel_shift). SECURITY
-- DEFINER should carry the needed privileges the same way it does for cron,
-- but it hasn't been exercised this way before — verify with a real publish
-- before relying on it, per this repo's "don't guess-fix blind" rule.
--
-- NOTE: the rostering worklog's own task list mentioned "claim/confirm
-- variants" for this trigger, but the finalized design spec (§6.2, not part
-- of this session's 10-part spec-edit list) only specifies publish/cancel —
-- that's what's implemented here. Flagged for David: if claim/confirm should
-- also notify (e.g. the coordinator learning their open shift was claimed),
-- that's an additional WHEN branch + edge-function target for a follow-up,
-- not invented here without a reconciled design.

begin;

create or replace function companion.notify_push_on_shift_publish()
returns trigger
language plpgsql security definer
set search_path = 'companion', 'public'
as $$
begin
  perform net.http_post(
    url     := 'https://oprsmhyvihrahxpfvdih.supabase.co/functions/v1/push-notify',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer ' || (
                   select decrypted_secret from vault.decrypted_secrets
                   where name = 'service_role_key'
                 )
               ),
    body    := jsonb_build_object('record', row_to_json(new), 'type', 'shift')
  );
  return new;
exception when others then
  -- Never let a notify failure block the status transition itself.
  return new;
end;
$$;

drop trigger if exists trg_notify_push_on_shift_publish on companion.shifts;
create trigger trg_notify_push_on_shift_publish
  after update on companion.shifts
  for each row
  when (
    (old.status = 'draft' and new.status = 'published')
    or (old.status in ('published','confirmed') and new.status = 'cancelled')
  )
  execute function companion.notify_push_on_shift_publish();

commit;

-- ═══ VERIFICATION ═════════════════════════════════════════════════════
-- Publish a draft shift as a test coordinator; confirm exactly one push-notify
-- invocation fires (check push-notify's own logs / a push_subscriptions row
-- receiving a request) and that editing `notes` on an already-published shift
-- does NOT fire it again.
