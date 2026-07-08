import { supabase } from './supabase'
import { checkPlan, isFamilyPlan } from './planCheck'
import type { Organisation, OrgType, BillingStatus } from '../types/database'

type OrgPatch = { plan: string; org_type: OrgType; billing_status: BillingStatus }

const MAB_STATUS: Record<string, BillingStatus> = {
  active: 'active', trialing: 'trial', trial: 'trial',
  past_due: 'past_due', paused: 'past_due', canceled: 'cancelled', cancelled: 'cancelled',
}

/**
 * The org's `plan`/`org_type` are a local mirror that only updates when this
 * runs — a plan change made through MAB (portal, pricing-table) never pushes
 * back to Companion on its own. Call this once per session (auth bootstrap)
 * to load the subscribed plan id and, if it disagrees with the stored one,
 * correct `plan`/`org_type`/`billing_status` so the experience follows the
 * plan. Fail-safe: only acts on a confident `plan_id` from MAB; a null/failed
 * lookup changes nothing.
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

  const planChanged = org.plan !== info.plan_id
  const typeChanged = org.org_type !== nextType
  const statusChanged = org.billing_status !== nextStatus
  if (!planChanged && !typeChanged && !statusChanged) return null

  const patch: OrgPatch = { plan: info.plan_id, org_type: nextType, billing_status: nextStatus }
  const { error } = await supabase.from('organisations').update(patch).eq('id', org.id)
  if (error) return null
  return patch
}
