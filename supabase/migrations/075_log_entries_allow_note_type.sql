-- ═══════════════════════════════════════════════════════════════════
-- 075 · Allow 'note' as a log entry type  (idempotent)
--
-- URGENT — core function broken. Run immediately; no dependencies on
-- 071/072/073/074, all of which are written but unrun. Safe in any order
-- relative to them: this touches only log_entries' type CHECK constraint,
-- which none of them reference.
--
-- THE BUG. 003_log_entries.sql:10-11 created:
--     type text not null check (type in ('meal','activity','mood','photo'))
-- and no migration since has altered it. But 'note' is offered as an
-- entry type in BOTH entry forms and in the TypeScript LogType union:
--   * src/pages/worker/WorkerClientDetail.tsx:33   { type: 'note', … }
--   * src/pages/family/AddEntry.tsx:11             'note'
--   * src/types/database.ts:13                     LogType includes 'note'
--
-- So picking "Note" and saving sends type='note', Postgres rejects it
-- with a check-constraint violation, and the user sees only "Could not
-- save entry." / "Could not save. Try again." — because both screens test
-- `e instanceof Error` and a Supabase PostgrestError is a plain object,
-- not an Error, so the real message is discarded and the generic fallback
-- shows. Reported live 2026-08-24 by a support worker and reproduced by a
-- coordinator; the coordinator case is what ruled out roles, permissions
-- and RLS, since coordinators have an unconditional INSERT policy.
--
-- This is long-standing, NOT a regression from the 2026-08-23/24 sub-role
-- work — verified: the constraint is untouched across all 74 prior
-- migrations. Every other entry type has always worked, which is why it
-- went unnoticed.
--
-- Widening a CHECK cannot invalidate existing rows, so there is nothing
-- to back-fill or verify beyond the constraint itself.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- Drop by lookup rather than by assumed name. The original constraint was
-- declared inline and auto-named by Postgres, so while it is almost
-- certainly `log_entries_type_check`, that is a convention rather than a
-- guarantee — and a wrong guess here would silently leave the old
-- constraint in place alongside the new one, leaving the bug live.
do $$
declare c record;
begin
  for c in
    select conname
    from   pg_constraint
    where  conrelid = 'companion.log_entries'::regclass
      and  contype = 'c'
      and  pg_get_constraintdef(oid) ilike '%type%meal%'
  loop
    execute format('alter table companion.log_entries drop constraint %I', c.conname);
  end loop;
end $$;

alter table companion.log_entries
  add constraint log_entries_type_check
  check (type in ('meal','activity','mood','note','photo'));

commit;

-- ═══ VERIFY ════════════════════════════════════════════════════════
-- 1. Exactly one type constraint, and it includes 'note'.
select conname, pg_get_constraintdef(oid) as def
from   pg_constraint
where  conrelid = 'companion.log_entries'::regclass
  and  contype = 'c'
  and  pg_get_constraintdef(oid) ilike '%type%meal%';

-- 2. Prove the previously-failing write now succeeds, then roll it back.
--    Substitute a real client_id / org_id / author_id from your own org.
-- begin;
--   insert into companion.log_entries (client_id, org_id, author_id, type, label)
--   values ('<client_id>', '<org_id>', '<author_id>', 'note', '075 constraint probe');
-- rollback;
