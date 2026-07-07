import { supabase } from './supabase'

export interface PlanInfo {
  plan: string | null
  status: string | null
  subscription_id: string | null
  account_id: string | null
}

export async function checkPlan(): Promise<PlanInfo> {
  try {
    const { data, error } = await supabase.functions.invoke('check-plan')
    if (error) return { plan: null, status: null, subscription_id: null, account_id: null }
    return data ?? { plan: null, status: null, subscription_id: null, account_id: null }
  } catch {
    return { plan: null, status: null, subscription_id: null, account_id: null }
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
