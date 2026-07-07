-- ─────────────────────────────────────────────────────────────
-- 050 · Retire the local plans table (parallel plan/feature store)
--
-- 009 created a `plans` table that duplicated plan names, prices, tier
-- labels and per-plan feature lists inside this app. MyAppBuddy is now
-- the single source of truth for plan/pricing/feature data — the app
-- reads the live catalog from the hub (Step2Plan) and reads per-plan
-- feature entitlements from the hub (check-features). Nothing in the
-- codebase reads this table, so it's a stale second source of truth.
-- Drop it.
-- ─────────────────────────────────────────────────────────────

drop table if exists public.plans;
