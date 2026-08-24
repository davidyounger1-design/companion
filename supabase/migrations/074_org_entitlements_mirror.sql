-- ═══════════════════════════════════════════════════════════════════
-- 074 · Server-side entitlements, Part 1 — mirror only (idempotent)
--
-- Full rationale: docs/superpowers/specs/2026-08-24-privacy-hardening-
-- design.md §3. That spec describes Pass B as ONE step (mirror + gate
-- together). This file deliberately ships ONLY the mirror — the column,
-- the fail-closed reader function, and the frontend write path
-- (src/lib/reconcilePlan.ts, already committed). It does NOT add the
-- restrictive gate policies yet.
--
-- WHY SPLIT: direct inspection 2026-08-24 found FOUR active orgs, not
-- the one the spec's risk analysis assumed —
--   "fred's Care Circle"       family,   plan companion_family_029
--   "Sarah Younger's Care..."  family,   plan "Family +"   (looks like
--                              a display name leaked into the plan-slug
--                              column, not a real MAB plan_id — separate
--                              pre-existing data-quality issue, not
--                              caused by or fixed here)
--   "The Friendship Circle" ×2 provider, plan companion_team_workers,
--                              same myappbuddy_subscription_id on both
--                              rows (the known duplicate-org issue from
--                              IMPLEMENTATION-QUEUE.md, still unresolved)
--
-- None of these have ever had entitlements resolved server-side before.
-- `behaviour_notes`, `medication_tracking` and `incident_workflows` are
-- not gated by `RequireFeature` anywhere in the frontend today (only
-- `messaging`, `goals`, `therapy_circles` are — grep App.tsx) — so there
-- is NO existing signal that any of these four orgs' MAB plans actually
-- have those keys ticked on in MAB Admin. Shipping a restrictive `for
-- all` gate on that assumption, sight unseen, risks locking all four
-- orgs out of tables they may be using right now — the exact failure
-- mode this spec's own §3 calls "far more visible than Pass A's."
--
-- SEQUENCING: run this file (safe — additive only, nothing reads
-- `entitlements` yet, so it changes no live behaviour). Once the
-- frontend redeploys and each org's coordinator/family member logs in
-- at least once, `organisations.entitlements` will populate for real.
-- THEN run the verification query at the bottom for all four orgs — if
-- any of behaviour_notes / medication_tracking / goals /
-- incident_workflows is missing for an org that is actually using that
-- table, that is a MAB Admin gap to fix (tick the feature onto that
-- plan) before Part 2 (the actual gate policies, a follow-up file) can
-- ship without breaking that org. Only once every live org's mirror is
-- confirmed correct should the gate go in.
-- ═══════════════════════════════════════════════════════════════════

begin;

alter table companion.organisations
  add column if not exists entitlements jsonb not null default '[]'::jsonb;

-- Array-of-keys, not the map-of-booleans the spec sketched — this is what
-- fetchFeatures()/check-features already produce (a Set<string> of included
-- keys), so reconcileOrgPlan writes it straight through with no reshaping.
-- The `?` jsonb operator below tests array-element membership.
create or replace function public.org_has_feature(feature_key text)
returns boolean language sql stable security definer
set search_path = 'companion', 'public' as $$
  select coalesce(
    (select entitlements ? feature_key
     from   companion.organisations
     where  id = public.my_org_id()),
    false
  )
$$;

commit;

-- ═══ RUN LATER, once each org has logged in at least once ══════════
-- For every org currently in use, cross-check its mirrored entitlements
-- against the feature keys its role screens actually exercise. A blank
-- cell for a table that org uses today means MAB Admin needs that key
-- ticked onto that plan before any gate can go live for it.
select id, name, plan, org_type,
       entitlements ? 'behaviour_notes'      as has_behaviour_notes,
       entitlements ? 'medication_tracking'  as has_medication_tracking,
       entitlements ? 'goals'                as has_goals,
       entitlements ? 'incident_workflows'   as has_incident_workflows,
       entitlements
from   companion.organisations
order  by name;
