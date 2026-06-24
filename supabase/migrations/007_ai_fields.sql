-- ─────────────────────────────────────────────────────────────
-- 007 · AI transparency fields   (idempotent)
--
-- ai_source  — which AI feature generated/assisted this row
--              e.g. 'digest_summary', 'entry_suggestion', 'behaviour_analysis'
-- ai_reason  — human-readable explanation shown to the user
--              e.g. 'Summarised from 6 log entries by AI'
-- ─────────────────────────────────────────────────────────────

alter table log_entries
  add column if not exists ai_source text,
  add column if not exists ai_reason text;

alter table behaviour_notes
  add column if not exists ai_source text,
  add column if not exists ai_reason text;
