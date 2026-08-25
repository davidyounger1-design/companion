import { supabase } from './supabase'
import { checkPlan, isFamilyPlan, planMeters } from './planCheck'
import { fetchFeatures } from './features'
import type { Organisation, OrgType, BillingStatus, MeteredAxis } from '../types/database'

type OrgPatch = Partial<{
  plan: string
  org_type: OrgType
  billing_status: BillingStatus
  seats: number | null
  metered_axis: MeteredAxis | null
  entitlements: string[]
}>

const MAB_STATUS: Record<string, BillingStatus> = {
  active: 'active', trialing: 'trial', trial: 'trial',
  past_due: 'past_due', paused: 'past_due', canceled: 'cancelled', cancelled: 'cancelled',
}

/**
 * The org's `plan`/`org_type`/`seats`/`metered_axis` are a local mirror that
 * only updates when this runs — a plan change made through MAB (portal,
 * pricing-table) never pushes back to Companion on its own. Call this once
 * per session (auth bootstrap) to load the subscribed plan and, if it
 * disagrees with the stored one, correct the mirror so the experience (and,
 * critically, the DB-level seat trigger on `clients`/invites) follows the
 * real plan. Fail-safe: only acts on a confident `plan_id` from MAB; a
 * null/failed lookup changes nothing.
 *
 * `seats`/`metered_axis` are mirrored onto the org row (not just read live in
 * each component) specifically so a Postgres trigger can enforce the seat cap
 * server-side — a client-side-only check is bypassable (slow network, extra
 * tabs, or calling the API directly), so this is the data the real
 * enforcement reads. `entitlements` is mirrored for the same reason, so
 * `public.org_has_feature()` can gate RLS server-side instead of trusting the
 * browser's `useFeatures()` check.
 *
 * Entitlements refresh independently of the plan_id lookup above —
 * `check-features` resolves the org's own stored subscription id directly,
 * so it isn't gated on `checkPlan()` succeeding.
 *
 * Returns whichever fields actually changed (for the caller to merge into
 * local state), or null if nothing needed to change.
 */
export async function reconcileOrgPlan(org: Organisation | null): Promise<OrgPatch | null> {
  if (!org?.id) return null
  const [info, features] = await Promise.all([checkPlan(), fetchFeatures()])

  const patch: OrgPatch = {}

  if (info.plan_id) {
    const nextType: OrgType = isFamilyPlan(info.plan_id) ? 'family' : 'provider'
    const nextStatus = (info.status && MAB_STATUS[info.status]) || org.billing_status
    const nextAxis = planMeters(info.plan_id)
    const nextSeats = nextAxis ? info.seats : null

    if (org.plan !== info.plan_id) patch.plan = info.plan_id
    if (org.org_type !== nextType) patch.org_type = nextType
    if (org.billing_status !== nextStatus) patch.billing_status = nextStatus
    if ((org.seats ?? null) !== nextSeats) patch.seats = nextSeats
    if ((org.metered_axis ?? null) !== nextAxis) patch.metered_axis = nextAxis
  }

  // features is null when the hub couldn't be reached — "unknown", not
  // "nothing included". Never mirror that over the stored entitlements:
  // org_has_feature() gates RLS server-side off this column, and one transient
  // fetch failure at login would otherwise wipe it and lock every member out
  // of plan-gated sections until the next successful login. An empty (non-null)
  // set is a real hub answer and is mirrored normally.
  if (features !== null) {
    const nextEntitlements = [...features].sort()
    const currentEntitlements = [...(org.entitlements ?? [])].sort()
    if (JSON.stringify(nextEntitlements) !== JSON.stringify(currentEntitlements)) {
      patch.entitlements = nextEntitlements
    }
  }

  if (Object.keys(patch).length === 0) return null

  const { error } = await supabase.from('organisations').update(patch).eq('id', org.id)
  if (error) return null
  return patch
}
