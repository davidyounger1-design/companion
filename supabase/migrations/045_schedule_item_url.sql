-- ─────────────────────────────────────────────────────────────
-- 045 · Optional website link on a schedule item
--
-- Lets whoever created an activity attach a related web page (e.g. a
-- video call link, a venue's site, a class's sign-up page) that the
-- recipient can open straight from the schedule.
-- ─────────────────────────────────────────────────────────────

alter table schedule_items add column if not exists url text;
