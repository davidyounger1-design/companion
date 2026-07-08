import { supabase } from './supabase'

export interface PlanInfo {
  plan: string | null
  status: string | null
  subscription_id: string | null
  account_id: string | null
  /** Quantity the subscriber bought at checkout (MAB `seats`). Null = unknown. */
  seats: number | null
}

export async function checkPlan(): Promise<PlanInfo> {
  try {
    const { data, error } = await supabase.functions.invoke('check-plan')
    const empty: PlanInfo = { plan: null, status: null, subscription_id: null, account_id: null, seats: null }
    if (error) return empty
    return { ...empty, ...(data ?? {}) }
  } catch {
    return { plan: null, status: null, subscription_id: null, account_id: null, seats: null }
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
// id — the same "semantics live in the id" pattern as isFamilyPlan. A plan id
// ending in `worker` caps workers (recipients unlimited); one ending in
// `participant` caps participants (workers unlimited). Anything else (family,
// unmetered/all-you-can-eat tiers) returns null = no cap. Only the metering
// AXIS lives here; the quantity is the subscription's seats.
export type MeteredAxis = 'workers' | 'participants'
export function planMeters(plan: string | null): MeteredAxis | null {
  if (!plan) return null
  if (/workers?$/i.test(plan)) return 'workers'
  if (/participants?$/i.test(plan)) return 'participants'
  return null
}
