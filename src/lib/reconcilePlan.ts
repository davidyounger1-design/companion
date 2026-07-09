import { supabase } from './supabase'
import { checkPlan, isFamilyPlan, planMeters } from './planCheck'
import type { Organisation, OrgType, BillingStatus, MeteredAxis } from '../types/database'

type OrgPatch = {
  plan: string
  org_type: OrgType
  billing_status: BillingStatus
  seats: number | null
  metered_axis: MeteredAxis | null
}

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
 * enforcement reads.
 *
 * Returns the patch that was written (for the caller to merge into local
 * state), or null if nothing needed to change.
 */
export async function reconcileOrgPlan(org: Organisation | null): Promise<OrgPatch | null> {
  if (!org?.id) return null
  const info = await checkPlan()
  if (!info.plan_id) return null

  const nextType: OrgType = isFamilyPlan(info.plan_id) ? 'family' : 'provider'
  const nextStatus = (info.status && MAB_STATUS[info.status]) || org.billing_status
  const nextAxis = planMeters(info.plan_id)
  const nextSeats = nextAxis ? info.seats : null

  const planChanged = org.plan !== info.plan_id
  const typeChanged = org.org_type !== nextType
  const statusChanged = org.billing_status !== nextStatus
  const seatsChanged = (org.seats ?? null) !== nextSeats
  const axisChanged = (org.metered_axis ?? null) !== nextAxis
  if (!planChanged && !typeChanged && !statusChanged && !seatsChanged && !axisChanged) return null

  const patch: OrgPatch = {
    plan: info.plan_id, org_type: nextType, billing_status: nextStatus,
    seats: nextSeats, metered_axis: nextAxis,
  }
  const { error } = await supabase.from('organisations').update(patch).eq('id', org.id)
  if (error) return null
  return patch
}
