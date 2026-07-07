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

// Every family-tier MAB plan behaves the same way in the app (family org,
// one recipient, unlimited members). Free `companion_family` and the paid
// flat-fee `companion_family_plus` both onboard as a family org. Add future
// family tiers here so signup routing recognises them.
const FAMILY_PLANS = new Set([FAMILY_PLAN, 'companion_family_plus'])

export function isFamilyPlan(plan: string | null): boolean {
  return plan != null && FAMILY_PLANS.has(plan)
}
