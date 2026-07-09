import { supabase } from './supabase'
import type { MeteredAxis } from '../types/database'

export type { MeteredAxis }

export interface PlanInfo {
  /** Display name from MAB (`planName`), for showing the plan to the user. */
  plan: string | null
  /** The MAB plan id (e.g. companion_solo_participant) — authoritative for
   *  planMeters()/isFamilyPlan(). Null until MAB's /link response includes it. */
  plan_id: string | null
  status: string | null
  subscription_id: string | null
  account_id: string | null
  /** Quantity the subscriber bought at checkout (MAB `seats`). Null = unknown. */
  seats: number | null
}

export async function checkPlan(): Promise<PlanInfo> {
  try {
    const { data, error } = await supabase.functions.invoke('check-plan')
    const empty: PlanInfo = { plan: null, plan_id: null, status: null, subscription_id: null, account_id: null, seats: null }
    if (error) return empty
    return { ...empty, ...(data ?? {}) }
  } catch {
    return { plan: null, plan_id: null, status: null, subscription_id: null, account_id: null, seats: null }
  }
}

export const FAMILY_PLAN = 'companion_family'

// Any MAB plan whose id starts with `companion_family` is a family-tier plan:
// the free `companion_family`, the paid flat-fee `companion_family_plus`, and
// any future family tiers. They all behave identically in the app (family org,
// one recipient, unlimited members). Naming a plan with this prefix in MAB is
// what marks it as family — no app change is needed to add more.
export function isFamilyPlan(plan: string | null): boolean {
  return plan != null && plan.startsWith(FAMILY_PLAN)
}

// Which resource a plan's `seats` quantity meters, read straight off the plan
// id — the same "semantics live in the id" pattern as isFamilyPlan. Rules:
//   - a plan id ending in `unlimited` → no cap on either axis (e.g. Enterprise)
//   - family plans (or the local 'family' sentinel) → participants
//   - any plan id ending in `participant` → participants
//   - every other (provider) plan → workers, the default
// So the only suffixes you ever add are `participant` or `unlimited`; worker-
// metering is implicit. Returns null when the plan is unknown OR explicitly
// unlimited — both cases mean "no cap" to the caller (fail open). The quantity
// comes from the subscription's seats, not from here.
export function planMeters(plan: string | null): MeteredAxis | null {
  if (!plan) return null
  if (/unlimited$/i.test(plan)) return null
  if (plan === 'family' || isFamilyPlan(plan)) return 'participants'
  if (/participants?$/i.test(plan)) return 'participants'
  return 'workers'
}
